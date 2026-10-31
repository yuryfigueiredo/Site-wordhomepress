/* memory.js — a memória do robô que sobrevive entre rodadas.

   O runner do Actions nasce limpo: pipeline/drafts/, pipeline/leads/ e
   pipeline/state/ são gitignored, então nada que uma rodada aprendeu existia
   na seguinte. Medido em 2026-10-31: a mesma pauta (Webb / mundos do tamanho de
   Marte) foi reescolhida em três rodadas seguidas, porque a única memória do
   pick-lead era o slug do título da pauta — e o id que vai ao ar é outro,
   inventado pelo modelo. Cada rodada gastou 4 chamadas de escrita e morreu no
   portão em "fonte já usada". Dia inteiro sem publicar, tudo verde no CI.

   A memória mora em pipeline/memory.json, versionada, e é a fonte única de
   "esta URL de fonte já foi publicada / já foi tentada / quando".            */
const fs = require("fs");
const path = require("path");

const ARQUIVO = path.join("pipeline", "memory.json");
const MAX_LEADS = 400;
const MAX_PUBLISHES = 60;

/* A mesma matéria chega por URLs que diferem só no fim: barra no cabo, http vs
   https,utm_ do feed. Sem normalizar, "fonte já usada" não pega. */
function urlChave(u) {
  let s = String(u || "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^http:\/\//, "https://");
  const hash = s.indexOf("#");
  const frag = hash >= 0 ? s.slice(hash) : "";
  if (hash >= 0) s = s.slice(0, hash);
  const q = s.indexOf("?");
  const query = q >= 0 ? s.slice(q + 1) : "";
  if (q >= 0) s = s.slice(0, q);
  /* utm_ é prefixo (utm_source, utm_medium, utm_campaign...); os outros são o
     nome exato da chave — "ref" casa com "ref=", não com "refresh=". */
  const lixo = (kv) => {
    const k = kv.split("=")[0];
    return k.startsWith("utm_") || ["ref", "source", "fbclid", "gclid", "igshid"].includes(k);
  };
  const keep = query.split("&").filter((kv) => kv && !lixo(kv));
  s = s.replace(/\/+$/, "");
  return s + (keep.length ? `?${keep.join("&")}` : "") + frag;
}

function ler(root) {
  let j = {};
  try {
    j = JSON.parse(fs.readFileSync(path.join(root, ARQUIVO), "utf8"));
  } catch {
    return { leads: {}, publishes: [] };
  }
  return {
    leads: j.leads && typeof j.leads === "object" ? j.leads : {},
    publishes: Array.isArray(j.publishes) ? j.publishes : [],
  };
}

/* tmp + rename: a rodada inteira lê este arquivo; escrita cortada no meio do
   caminho deixaria o pick-lead sem memória nenhuma (e o JSON quebrado cai no
   catch de ler(), que devolve vazio — o apagamento silencioso que já temos). */
function gravar(root, mem) {
  const chaves = Object.keys(mem.leads);
  if (chaves.length > MAX_LEADS) {
    const velhas = chaves
      .sort((a, b) => String(mem.leads[a].at || "").localeCompare(String(mem.leads[b].at || "")))
      .slice(0, chaves.length - MAX_LEADS);
    for (const k of velhas) delete mem.leads[k];
  }
  const alvo = path.join(root, ARQUIVO);
  const tmp = `${alvo}.tmp`;
  const out = {
    updated: new Date().toISOString(),
    leads: mem.leads,
    publishes: mem.publishes.slice(-MAX_PUBLISHES),
  };
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + "\n");
  fs.renameSync(tmp, alvo);
}

function registrar(root, url, outcome, extra = {}) {
  const chave = urlChave(url);
  if (!chave) return null;
  const store = ler(root);
  store.leads[chave] = { ...(store.leads[chave] || {}), ...extra, outcome, at: new Date().toISOString() };
  gravar(root, store);
  return store.leads[chave];
}

/* Quantas horas um resultado ainda segura a pauta fora da fila. */
const BLOQUEIO_PADRAO = { em_andamento: 6, falha_brief: 24, falha_texto: 24, falha_publicacao: 24, reprovada: 72, publicada: Infinity };

function bloqueada(rec, horas) {
  if (!rec || !rec.outcome) return false;
  if (rec.outcome === "publicada") return true;
  const tabela = { ...BLOQUEIO_PADRAO, ...(horas || {}) };
  const h = tabela[rec.outcome];
  if (h === undefined || h === null) return false;
  if (!Number.isFinite(h)) return true;
  const at = Date.parse(rec.at || "");
  /* Registro sem data legível: trata como recente e deixa a pauta em paz — o
    custo é pular uma pauta, o ganho é não queimar o dia inteiro nela de novo. */
  if (isNaN(at)) return true;
  return Date.now() - at < h * 3600 * 1000;
}

/* Toda URL que uma matéria publicada já cita — no campo sources e no corpo.
   O corpo conta porque as matérias antigas do acervo não têm sources[]: sem
   varrer os hrefs, a mesma fonte voltaria da fila, seria aceita pelo pick-lead e
   reprovada três chamadas de modelo depois pelo portão do check-post. É a mesma
   definição usada lá, para as duas decisões não divergirem. */
function fontesPublicadas(db, excetoId) {
  const set = new Set();
  for (const item of [...(db.articles || []), ...(db.reviews || [])]) {
    if (excetoId && item.id === excetoId) continue;
    for (const s of item.sources || []) if (s && s.url) set.add(urlChave(s.url));
    const corpo = `${item.content || ""}${item.prose || ""}`;
    for (const m of corpo.matchAll(/href="(https?:\/\/[^"]+)"/g)) set.add(urlChave(m[1]));
  }
  return set;
}

/* Coluna recorrente: "The best recent science fiction ... review roundup" sai
   toda semana no Guardian com URL de data diferente. A URL não bate com a que
   já está no ar, a idade é fresquinha e o título que o robô escreve é outro — os
   três filtros atuais deixam passar e a mesma coluna viraria matéria de novo.
   O que identifica a coluna é o título da fonte citada, que está em sources[]. */
function tituloChave(t) {
  return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titulosFontesPublicadas(db) {
  const set = new Set();
  for (const item of [...(db.articles || []), ...(db.reviews || [])]) {
    for (const s of item.sources || []) {
      const k = s && s.title ? tituloChave(s.title) : "";
      if (k) set.add(k);
    }
  }
  return set;
}

/* Marca como publicada a URL da pauta E todas as URLs citadas pela matéria.
   Só a fonte citada não bastaria: o modelo pode citar o paper original e deixar
   a notícia do portal de fora — no dia seguinte o pick-lead reescolheria a mesma
   pauta e o portão não reclamaria de fonte repetida. */
function registrarPublicacao(root, urls, id, score) {
  const store = ler(root);
  store.publishes.push({ id, at: new Date().toISOString(), score: typeof score === "number" ? score : null });
  const at = new Date().toISOString();
  for (const u of [].concat(urls || [])) {
    const chave = urlChave(u);
    if (chave) store.leads[chave] = { ...(store.leads[chave] || {}), outcome: "publicada", at, id };
  }
  gravar(root, store);
}

const diaUTC = (iso) => String(iso || "").slice(0, 10);

function publicacoesNoDia(root, dia) {
  const alvo = dia || diaUTC(new Date().toISOString());
  return ler(root).publishes.filter((p) => diaUTC(p.at) === alvo).length;
}

function ultimaPublicacaoEm(root, horas) {
  const list = ler(root).publishes;
  if (!list.length) return null;
  const at = Date.parse(list[list.length - 1].at || "");
  if (isNaN(at)) return null;
  return (Date.now() - at) / 3600000;
}

module.exports = {
  ARQUIVO,
  urlChave,
  tituloChave,
  ler,
  gravar,
  registrar,
  registrarPublicacao,
  bloqueada,
  fontesPublicadas,
  titulosFontesPublicadas,
  publicacoesNoDia,
  ultimaPublicacaoEm,
};
