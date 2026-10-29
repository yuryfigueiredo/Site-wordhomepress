/* score.js — a nota das matérias é CALCULADA, não digitada.
   Cinco critérios objetivos medidos no texto e nos metadados + um décimo de
   julgamento do modelo, limitado a 1,0 ponto e com justificativa obrigatória.
   Ninguém precisa intervir: publish.js chama isto, build.js lê o resultado.

   Uso:
     node tools/score.js --draft <slug>     nota de um rascunho (lê metrics.json)
     node tools/score.js --rescore          nota tudo que ainda não tem nota
     node tools/score.js --rank             imprime o ranking atual
   Fonte única da verdade: pipeline/scores.json (versionado no git).          */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCORES_FILE = path.join(ROOT, "pipeline", "scores.json");
const STATE_DIR = path.join(ROOT, "pipeline", "state");

global.window = {};
require(path.join(ROOT, "js", "articles-db.js"));
const DB = global.window.HWP_DATABASE;

const WEIGHTS = { evidence: 2.5, timeliness: 1.5, novelty: 2.0, craft: 2.0, commercial: 1.0, judgment: 1.0 };
const stripTags = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s) =>
  stripTags(s)
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length > 3);
const STOP = new Set("this that with from their about which there would could should after before into over under more most than them they you your what when where why how the and for are was were been have has had not but all its our your".split(" "));
const keyTokens = (s) => [...new Set(tokens(s).filter((w) => !STOP.has(w)))];
const overlap = (a, b) => {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  return a.filter((w) => setB.has(w)).length / Math.min(a.length, b.length);
};
const round1 = (n) => Math.round(n * 10) / 10;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const dayDiff = (iso) => (Date.now() - new Date(iso + "T00:00:00Z").getTime()) / 86400000;

function loadScores() {
  try {
    const j = JSON.parse(fs.readFileSync(SCORES_FILE, "utf8"));
    return { updated: j.updated || null, scores: j.scores || {} };
  } catch {
    return { updated: null, scores: {} };
  }
}
function saveScores(store) {
  store.updated = new Date().toISOString();
  fs.writeFileSync(SCORES_FILE, JSON.stringify(store, null, 2) + "\n");
}

/* Merga as notas no catálogo em memória. Nota manual (source:"manual") nunca é
   sobrescrita por recálculo automático. */
function applyScores(store) {
  for (const a of DB.articles || []) {
    const rec = store.scores[a.id];
    if (!rec) continue;
    a.rank = rec.score;
    a.rankNote = rec.note || "";
  }
  return DB;
}

/* ── os critérios ─────────────────────────────────────────────────────── */
function evidence(entry) {
  const sources = (entry.sources || []).filter((s) => s && s.url);
  if (!sources.length) return { pts: 0, why: "sem fontes — analysis_only" };
  const domains = new Set(sources.map((s) => {
    try { return new URL(s.url).hostname.replace(/^www\./, ""); } catch { return s.url; }
  }));
  const primary = sources.filter((s) => s.type === "primary").length;
  const dated = sources.filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date || "")).length;
  let pts = 0.6 * Math.min(domains.size / 3, 1) + 0.5 * (primary / sources.length) + 0.4 * (dated / sources.length);
  pts += sources.length >= 5 ? 0.5 : sources.length >= 3 ? 0.25 : 0;
  pts *= WEIGHTS.evidence / 2.0;
  return { pts: clamp(pts, 0, WEIGHTS.evidence), why: `${sources.length} fonte(s), ${domains.size} domínio(s), ${primary} primária(s)` };
}

function timeliness(entry) {
  const dates = (entry.sources || []).map((s) => s.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || ""));
  if (!dates.length) {
    const pts = (entry.evidence_level === "analysis_only" ? 0.8 : 0.4) * (WEIGHTS.timeliness / 1.5);
    return { pts: clamp(pts, 0, WEIGHTS.timeliness), why: "fontes sem data" };
  }
  const newest = Math.min(...dates.map(dayDiff));
  const pts = newest <= 7 ? 1.5 : newest <= 30 ? 1.15 : newest <= 90 ? 0.75 : 0.3;
  return { pts: clamp(pts * (WEIGHTS.timeliness / 1.5), 0, WEIGHTS.timeliness), why: `fonte mais recente há ${Math.round(newest)} dia(s)` };
}

function novelty(entry, store) {
  const mine = keyTokens((entry.title || "") + " " + stripTags(entry.dek));
  let worst = 0;
  let worstId = null;
  for (const a of DB.articles || []) {
    if (a.id === entry.id) continue;
    const theirs = keyTokens((a.title || "") + " " + stripTags(a.dek));
    const o = overlap(mine, theirs);
    if (o > worst) { worst = o; worstId = a.id; }
  }
  const pts = worst >= 0.72 ? 0.1 : worst >= 0.5 ? 0.8 : worst >= 0.3 ? 1.5 : 2.0;
  return {
    pts: clamp(pts * (WEIGHTS.novelty / 2.0), 0, WEIGHTS.novelty),
    why: worstId ? `sobrepõe ${Math.round(worst * 100)}% com ${worstId}` : "assunto inédito no catálogo",
    blocked: worst >= 0.72,
  };
}

function craft(entry, metrics) {
  if (!metrics) return { pts: WEIGHTS.craft * 0.5, why: "sem métricas medidas — nota neutra" };
  let ratio = 1;
  if (metrics.banned_templates_found) ratio -= 0.25;
  if (metrics.numbers_without_source) ratio -= 0.15 * metrics.numbers_without_source;
  if (metrics.longest_sentence_words > 30) ratio -= 0.15;
  if (metrics.shortest_sentence_words >= 8) ratio -= 0.2;
  if (!metrics.has_one_sentence_paragraph) ratio -= 0.1;
  if (metrics.humor_lines > 2) ratio -= 0.1;
  if (metrics.word_count_ratio < 0.85 || metrics.word_count_ratio > 1.25) ratio -= 0.2;
  return { pts: clamp(ratio, 0, 1) * WEIGHTS.craft, why: `ritmo e léxico medidos (${Math.round(clamp(ratio, 0, 1) * 100)}%)` };
}

function commercial(entry) {
  const products = (entry.products || []).filter((p) => p && p.name);
  if (!products.length && !entry.affiliateBox) return { pts: 0, why: "sem produto nem caixa de afiliado" };
  const priced = products.filter((p) => p.price && /\d/.test(String(p.price))).length;
  const tested = products.filter((p) => p.tested && String(p.test_notes || "").length > 20).length;
  let pts = 0.3 + (priced ? 0.25 : 0) + (entry.affiliateBox ? 0.25 : 0) + (tested ? 0.2 : 0);
  return { pts: clamp(pts, 0, 1) * WEIGHTS.commercial, why: `${products.length} produto(s), ${priced} com preço, ${tested} testado(s)` };
}

function judgment(entry) {
  const r = entry.ranking || null;
  if (!r || typeof r.thesis_strength !== "number" || !String(r.why || "").trim()) {
    return { pts: WEIGHTS.judgment * 0.5, why: "modelo não declarou julgamento — metade do peso", declared: null };
  }
  const sub = clamp(r.thesis_strength, 0, 2) / 2;
  return { pts: sub * WEIGHTS.judgment, why: String(r.why).trim().slice(0, 140), declared: sub };
}

/* ── a nota ───────────────────────────────────────────────────────────── */
function scoreEntry(entry, opts = {}) {
  const store = opts.store || loadScores();
  const parts = {
    evidence: evidence(entry),
    timeliness: timeliness(entry),
    novelty: novelty(entry, store),
    craft: craft(entry, opts.metrics),
    commercial: commercial(entry),
    judgment: judgment(entry),
  };
  let total = Object.values(parts).reduce((s, p) => s + p.pts, 0);

  const penalties = [];
  if (entry.evidence_level === "analysis_only") { total -= 0.5; penalties.push("analysis_only −0,5"); }
  if (parts.novelty.blocked) { total -= 2.0; penalties.push("quase-duplicata −2,0"); }
  if (!entry.image) { total -= 0.5; penalties.push("sem imagem −0,5"); }
  total = clamp(round1(total), 0, 10);

  const ranked = Object.entries(parts).sort((a, b) => b[1].pts / WEIGHTS[b[0]] - a[1].pts / WEIGHTS[a[0]]);
  const weakest = ranked[ranked.length - 1];
  const note = penalties.length
    ? `${total}/10 — ${penalties.join(", ")}; ponto fraco: ${weakest[0]} (${weakest[1].why})`
    : `${total}/10 — força em ${ranked[0][0]} (${ranked[0][1].why}); ponto fraco: ${weakest[0]} (${weakest[1].why})`;

  return {
    score: total,
    note,
    breakdown: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, { pts: round1(v.pts), max: WEIGHTS[k], why: v.why }])),
    penalties,
    duplicate: parts.novelty.blocked,
  };
}

function record(store, id, res, source = "auto") {
  const prev = store.scores[id];
  if (prev && prev.source === "manual") return prev;
  store.scores[id] = { score: res.score, note: res.note, breakdown: res.breakdown, source, date: new Date().toISOString().slice(0, 10) };
  return store.scores[id];
}

/* ── CLI ──────────────────────────────────────────────────────────────── */
function readDraft(slug) {
  if (!/^[a-z0-9_-]+$/.test(slug)) { console.error("slug inválido"); process.exit(2); }
  const dir = path.join(ROOT, "pipeline", "drafts", slug);
  const raw = fs.readFileSync(path.join(dir, "draft.json"), "utf8").replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
  const draft = JSON.parse(raw);
  let metrics = null;
  try { metrics = JSON.parse(fs.readFileSync(path.join(dir, "metrics.json"), "utf8")); } catch {}
  return { draft, metrics, dir };
}

function printRank(store) {
  applyScores(store);
  const rows = (DB.articles || [])
    .map((a) => ({ id: a.id, score: typeof a.rank === "number" ? a.rank : null, title: a.title }))
    .sort((x, y) => (y.score == null ? -1 : y.score) - (x.score == null ? -1 : x.score));
  console.log("RANKING — a maior nota vai para a capa\n");
  rows.forEach((r, i) => {
    const mark = i === 0 && r.score != null ? "CAPA " : "     ";
    console.log(`${mark}${r.score == null ? "  —  " : String(r.score).padStart(4)} · ${r.id}`);
  });
  const unscored = rows.filter((r) => r.score == null).length;
  if (unscored) console.log(`\n${unscored} matéria(s) sem nota — a capa manual continua valendo enquanto for assim.`);
}

function main() {
  const argv = process.argv.slice(2);
  const store = loadScores();

  if (argv.includes("--rank")) { printRank(store); return; }

  if (argv.includes("--draft")) {
    const slug = argv[argv.indexOf("--draft") + 1];
    const { draft, metrics, dir } = readDraft(slug);
    const res = scoreEntry(draft, { metrics, store });
    /* Só entra no ranking quando quem chama garante a publicação (--record,
       usado pelo publish.js). Avaliar um rascunho não pode sujar scores.json. */
    if (argv.includes("--record")) {
      record(store, draft.id, res, "auto");
      saveScores(store);
    }
    fs.writeFileSync(path.join(dir, "score.json"), JSON.stringify(res, null, 2) + "\n");
    console.log(`nota ${res.score}/10 · ${draft.id}`);
    console.log(res.note);
    for (const [k, v] of Object.entries(res.breakdown)) console.log(`  ${k.padEnd(11)} ${String(v.pts).padStart(4)} / ${v.max}   ${v.why}`);
    if (res.duplicate) { console.log("DUPLICATA provável — não publique esta matéria."); process.exitCode = 1; }
    return;
  }

  if (argv.includes("--baseline")) {
    /* Matérias escritas antes do pipeline não têm sources[] nem metrics: a
       rubrica não tem o que medir nelas. Elas recebem uma nota de base fixa,
       marcada como "baseline", para que uma matéria nova precise vencer a capa
       atual em vez de herdá-la de graça. */
    const HERO_BASE = Number(argv[argv.indexOf("--baseline") + 1] || "") || 7.0;
    const REST_BASE = 5.0;
    let n = 0;
    for (const a of DB.articles || []) {
      const prev = store.scores[a.id];
      if (prev && (prev.source === "manual" || prev.source === "auto")) continue;
      const base = a.isHeroLead ? HERO_BASE : REST_BASE;
      store.scores[a.id] = {
        score: base,
        note: `${base}/10 — nota de base do acervo anterior ao pipeline (sem sources[] para medir). ${a.isHeroLead ? "Capa vigente: matéria nova só toma o lugar se passar disso." : "Feed."}`,
        breakdown: { baseline: { pts: base, max: 10, why: "acervo legado" } },
        source: "baseline",
        date: new Date().toISOString().slice(0, 10),
      };
      n++;
    }
    saveScores(store);
    console.log(`${n} matéria(s) do acervo com nota de base (capa vigente = ${HERO_BASE})`);
    printRank(store);
    return;
  }

  if (argv.includes("--rescore")) {
    applyScores(store);
    let n = 0;
    const skipped = [];
    for (const a of DB.articles || []) {
      const prev = store.scores[a.id];
      if (prev && prev.source === "manual") continue;
      if (!(a.sources || []).length) { skipped.push(a.id); continue; }
      const res = scoreEntry({ ...a, id: a.id }, { store });
      record(store, a.id, res, "auto");
      n++;
    }
    saveScores(store);
    console.log(`${n} matéria(s) reavaliada(s) pela rubrica`);
    if (skipped.length) console.log(`${skipped.length} sem sources[] no catálogo — mantêm a nota de base (rode --baseline uma vez)`);
    printRank(store);
    return;
  }

  console.error("uso: node tools/score.js --draft <slug> | --baseline [notaDaCapa] | --rescore | --rank");
  process.exit(2);
}

if (require.main === module) main();
module.exports = { scoreEntry, loadScores, saveScores, applyScores, record, WEIGHTS, SCORES_FILE, STATE_DIR };
