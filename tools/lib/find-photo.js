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
  "a an the and or but if then else of for to in on at by with from into onto as is are was were be been being do does did not no nor so than that this these those it its he she they them their his her your our us me my mine yours ours whose which who whom what when where why how over under between among during before after while within without per via up down out off again further once here there all any both each few more most other some such only own same too very just now also new old first second third enters enter".split(
    " ",
  ),
);

const CATEGORY_QUERY = {
  science: "NASA space rocket launch galaxy",
  culture: "books library reading writing author",
  tech: "computer technology circuit engineer",
  reviews: "consumer electronics gadget desk",
};

function keywords(text, max) {
  const seen = [];
  for (const w of String(text || "").toLowerCase().match(/[a-z0-9][a-z0-9-]{1,}/g) || []) {
    if (STOPWORDS.has(w) || /^\d/.test(w)) continue;
    if (!seen.includes(w)) seen.push(w);
    if (seen.length >= max) break;
  }
  return seen.join(" ");
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
   deles travou a publicação. */
async function searchUnsplash(query) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return { photo: null, reason: "sem UNSPLASH_ACCESS_KEY" };
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`;
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Client-ID ${key}` } });
  } catch (err) {
    return { photo: null, reason: `unsplash sem resposta: ${err.message}` };
  }
  if (!res.ok) return { photo: null, reason: `unsplash HTTP ${res.status}` };
  const data = await res.json();
  if (!data.results || !data.results.length) return { photo: null, reason: `unsplash 0 resultados (total ${data.total})` };
  const photo = data.results[0];
  return {
    photo: {
      url: photo.urls.regular,
      author: photo.user.name,
      credit: `Photo by ${photo.user.name} on Unsplash`,
      download: photo.urls.regular.replace("w=1080", "w=1200"),
    },
    reason: null,
  };
}

/* Busca no Pexels: retorna { photo, reason }. */
async function searchPexels(query) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return { photo: null, reason: "sem PEXELS_API_KEY" };
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`;
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: key } });
  } catch (err) {
    return { photo: null, reason: `pexels sem resposta: ${err.message}` };
  }
  if (!res.ok) return { photo: null, reason: `pexels HTTP ${res.status}` };
  const data = await res.json();
  if (!data.photos || !data.photos.length) return { photo: null, reason: "pexels 0 resultados" };
  const photo = data.photos[0];
  return {
    photo: {
      url: photo.src.large2x,
      author: photo.photographer,
      credit: `Photo by ${photo.photographer} from Pexels`,
      download: photo.src.large2x,
    },
    reason: null,
  };
}

/* Um candidato: Unsplash → Pexels. */
async function tryQuery(query, outPath) {
  const attempts = [];
  const u = await searchUnsplash(query);
  attempts.push(`unsplash: ${u.photo ? "ok" : u.reason}`);
  if (u.photo) {
    await download(u.photo.download, outPath);
    return { foto: { local: `images/posts/${path.basename(outPath)}`, ...u.photo }, attempts };
  }
  const p = await searchPexels(query);
  attempts.push(`pexels: ${p.photo ? "ok" : p.reason}`);
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

module.exports = { findPhoto, findPhotoSmart, photoQueries };
