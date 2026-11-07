/* find-photo.js — busca foto real para a matéria com fallback Unsplash → Pexels.
   Salva em images/posts/<slug>.jpg e retorna { url, author, credit }.
   Uso: const foto = await findPhotoSmart(slug, draft);
   Chaves: UNSPLASH_ACCESS_KEY (armada no CI) e PEXELS_API_KEY (só local, via
   .env). Falta chave é motivo devolvido, não exceção: quem chama decide o portão. */

const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = path.join(ROOT, "images", "posts");

/* Carrega .env manualmente (sem dependência dotenv). */
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .forEach((l) => {
      const [k, ...v] = l.split("=");
      if (k && v.length) process.env[k.trim()] = v.join("=").trim();
    });
}

/* ── candidatos de query ──────────────────────────────────────────────── */
/* A busca antiga usava as 6 primeiras palavras do título e devolvia 0
   resultados: "Artemis IV Refueling Plan Enters Its culture" não é
   vocabulário de banco de imagem. Aqui cada rascunho vira uma lista de
   candidatos, testados em ordem, e o portão do publish só deixa passar
   foto real. */
const STOPWORDS = new Set(
  "a an the and or but if then else of for to in on at by with from into onto as is are was were be been being do does did not no nor so than that this these those it its he she they them their his her your our us me my mine yours ours whose which who whom what when where why how over under between among during before after while within without per via up down out off again further once here there all any both each few more most other some such only own same too very just now also new old first second third enters enter let lets may might must will shall would could should say says said tell tells make makes like likely about around versus vs".split(
    " ",
  ),
);

/* Um banco de imagem não sabe o que é "a gauge field" e devolve outra coisa
   quando a query tem numeral: a manchete "Two Trapped Ions Let a Gauge Field…"
   virava a query "two trapped ions let", e o banco respondeu com um render 3D
   genérico com a palavra QUANTUM escrita (blob af79d7c6, 102 987 B, no ar de
   07/11 até a troca). Os numerais são riscados da query E cobrados pelo portão
   de check-post.js, que importa esta mesma régua. */
const NUMERAIS = new Set(
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty hundred dozen half quarter".split(
    " ",
  ),
);

const CATEGORY_QUERY = {
  science: "NASA space rocket launch galaxy",
  culture: "books library reading writing author",
  tech: "computer technology circuit engineer",
  reviews: "consumer electronics gadget desk",
};

/* Palavras que uma câmera consegue apontar: sem stopword, sem numeral, sem
   número sozinho. É a unidade de medida da régua de foto. */
function palavrasConcretas(text) {
  const out = [];
  for (const w of String(text || "").toLowerCase().match(/[a-z][a-z0-9-]{1,}/g) || []) {
    if (STOPWORDS.has(w) || NUMERAIS.has(w)) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

function keywords(text, max) {
  return palavrasConcretas(text).slice(0, max).join(" ");
}

/* A régua do photoQuery mora aqui e o check-post.js a importa: duas
   implementações de "o que é uma query decente" foi como a matéria de íons
   passou pelo editor com uma frase de manchete no lugar da cena. */
function validaPhotoQuery(q) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return { ok: false, motivo: "vazio" };
  const tokens = s.split(/[^a-z0-9-]+/).filter(Boolean);
  if (tokens.length > 6) return { ok: false, motivo: `${tokens.length} palavras (máximo 6)` };
  const numerais = tokens.filter((w) => NUMERAIS.has(w));
  if (numerais.length) return { ok: false, motivo: `número por extenso: ${numerais.join(", ")}` };
  if (palavrasConcretas(s).length < 2) return { ok: false, motivo: "menos de 2 palavras que uma câmera consegue apontar" };
  return { ok: true, motivo: null };
}

function photoQueries(draft) {
  const out = [];
  if (draft.photoQuery) out.push(String(draft.photoQuery));
  const t = keywords(draft.title, 4);
  if (t) out.push(t);
  const d = keywords(draft.dek, 5);
  if (d) out.push(d);
  /* Resenha não tem dek nem category: o produto vencedor do teste é a
     descrição mais concreta que existe do que a foto precisa mostrar. */
  const p = keywords(draft.topPickName, 4);
  if (p) out.push(p);
  const c = keywords(`${draft.kicker || ""} ${draft.subtopic || ""}`, 3);
  if (c) out.push(c);
  out.push(CATEGORY_QUERY[draft.category] || (draft.topPickName ? CATEGORY_QUERY.reviews : CATEGORY_QUERY.science));
  return [...new Set(out.filter(Boolean))];
}

/* Quantas palavras concretas da query aparecem INTEIRAS na legenda do banco.
   É a única prova de assunto que existe sem olhar a imagem — e tem de ser
   palavra, não pedaço: com includes(), "ion" casava dentro de "transmission"
   e "station" e a foto passava na prova sem ser de íon nenhum. Uma foto que
   não nomeia nada da matéria não é da matéria. */
function sobreposicao(query, ...legendas) {
  const texto = legendas.filter(Boolean).join(" ").toLowerCase();
  if (!texto.trim()) return null;
  let n = 0;
  for (const w of palavrasConcretas(query)) {
    if (new RegExp(`(^|[^a-z0-9])${w}s?([^a-z0-9]|$)`).test(texto)) n++;
  }
  return n;
}

/* Escolhe entre as candidatas do banco. A prova de assunto vem antes da
   popularidade, mas o empate é decidido por curtidas. Medido em 07/11 com a
   query "ion trap laser laboratory vacuum": results[0] era "a machine in a
   room" (nenhuma palavra da query na legenda), a única com "laser" era a última
   da lista ("black and gray corded laser machine tool", 2 curtidas) e as três
   do meio eram máquina com luz roxa de 4 a 13 curtidas — a ordem que o banco
   devolve não é ordem de assunto, e também não é ordem de qualidade. */
function escolheMelhor(candidatas) {
  return candidatas.reduce((a, b) => {
    if (b.match === null) return a;
    if (a.match === null || b.match > a.match) return b;
    if (b.match === a.match && b.likes > a.likes) return b;
    return a;
  }, candidatas[0]);
}

/* Download de imagem com timeout. */
const download = (url, outPath, timeoutMs = 8000) =>
  new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const stream = fs.createWriteStream(outPath);
      res.pipe(stream);
      stream.on("finish", () => { stream.close(); resolve(outPath); });
      stream.on("error", reject);
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
  });

/* Busca no Unsplash. O motivo da falha volta junto: sem chave, cota estourada
   e "0 resultados" são diagnósticos diferentes, e o alerta precisa dizer qual
   deles travou a publicação.
   Pede 5 candidatas e escolhe pela legenda: results[0] é a aposta do banco, e
   foi ela que colocou um render de "QUANTUM" numa matéria de íons presos. */
async function searchUnsplash(query) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return { photo: null, reason: "sem UNSPLASH_ACCESS_KEY" };
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`;
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Client-ID ${key}` } });
  } catch (err) {
    return { photo: null, reason: `unsplash sem resposta: ${err.message}` };
  }
  if (!res.ok) return { photo: null, reason: `unsplash HTTP ${res.status}` };
  const data = await res.json();
  if (!data.results || !data.results.length) return { photo: null, reason: `unsplash 0 resultados (total ${data.total})` };
  const avaliadas = data.results.map((photo) => ({ photo, match: sobreposicao(query, photo.alt_description, photo.description), likes: photo.likes || 0 }));
  const melhor = escolheMelhor(avaliadas);
  if (melhor.match === 0) {
    return { photo: null, reason: `unsplash: nenhuma das ${data.results.length} legendas menciona a query` };
  }
  return {
    photo: {
      url: melhor.photo.urls.regular,
      author: melhor.photo.user.name,
      credit: `Photo by ${melhor.photo.user.name} on Unsplash`,
      download: melhor.photo.urls.regular.replace("w=1080", "w=1200"),
      alt: melhor.photo.alt_description || null,
      match: melhor.match,
    },
    reason: null,
  };
}

/* Busca no Pexels: retorna { photo, reason }. Mesma conferência de legenda do
   Unsplash — os dois bancos escolhem por popularidade, não por assunto. */
async function searchPexels(query) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return { photo: null, reason: "sem PEXELS_API_KEY" };
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`;
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: key } });
  } catch (err) {
    return { photo: null, reason: `pexels sem resposta: ${err.message}` };
  }
  if (!res.ok) return { photo: null, reason: `pexels HTTP ${res.status}` };
  const data = await res.json();
  if (!data.photos || !data.photos.length) return { photo: null, reason: "pexels 0 resultados" };
  const avaliadas = data.photos.map((photo) => ({ photo, match: sobreposicao(query, photo.alt, photo.description), likes: photo.likes || photo.like_count || 0 }));
  const melhor = escolheMelhor(avaliadas);
  if (melhor.match === 0) {
    return { photo: null, reason: `pexels: nenhuma das ${data.photos.length} legendas menciona a query` };
  }
  return {
    photo: {
      url: melhor.photo.src.large2x,
      author: melhor.photo.photographer,
      credit: `Photo by ${melhor.photo.photographer} from Pexels`,
      download: melhor.photo.src.large2x,
      alt: melhor.photo.alt || null,
      match: melhor.match,
    },
    reason: null,
  };
}

/* Um candidato: Unsplash → Pexels. O log diz COM QUE PROVA a foto foi aceita,
   porque o alerta e o painel precisam distinguir "foto do assunto" de "foto
   que o banco devolveu e ninguém conseguiu conferir a legenda". */
const veredito = (p) => (p.match === null ? "ok (sem legenda para conferir)" : `ok (${p.match} palavra(s) da query na legenda)`);

async function tryQuery(query, outPath) {
  const attempts = [];
  const u = await searchUnsplash(query);
  attempts.push(`unsplash: ${u.photo ? veredito(u.photo) : u.reason}`);
  if (u.photo) {
    await download(u.photo.download, outPath);
    return { foto: { local: `images/posts/${path.basename(outPath)}`, ...u.photo }, attempts };
  }
  const p = await searchPexels(query);
  attempts.push(`pexels: ${p.photo ? veredito(p.photo) : p.reason}`);
  if (p.photo) {
    await download(p.photo.download, outPath);
    return { foto: { local: `images/posts/${path.basename(outPath)}`, ...p.photo }, attempts };
  }
  return { foto: null, attempts };
}

/* Busca com candidatos de query; log de cada tentativa para o alerta. */
async function findPhotoSmart(slug, draft) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${slug}.jpg`);
  const log = [];
  for (const query of photoQueries(draft)) {
    const { foto, attempts } = await tryQuery(query, outPath);
    log.push({ query, attempts });
    if (foto) return { foto, log };
  }
  return { foto: null, log };
}

/* Busca com uma query única — para quem já sabe exatamente o que quer. */
async function findPhoto(slug, query, category) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${slug}.jpg`);
  const { foto } = await tryQuery(query, outPath);
  return foto;
}

module.exports = { findPhoto, findPhotoSmart, photoQueries, keywords, palavrasConcretas, validaPhotoQuery, sobreposicao, escolheMelhor, searchUnsplash, searchPexels };
