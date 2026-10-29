/* pick-lead.js — escolhe a próxima pauta sem interação humana.
   Imprime uma linha JSON {url, pillar, topic, slug} da melhor pauta do dia que
   ainda não tenha rascunho; exit 1 quando não há nenhuma (a rodada só coleta).

   Uso: node tools/pick-lead.js                                              */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LEADS = path.join(ROOT, "pipeline", "leads");
const DRAFTS = path.join(ROOT, "pipeline", "drafts");

const slugify = (s) =>
  String(s).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

global.window = {};
require(path.join(ROOT, "js", "articles-db.js"));
const published = new Set(global.window.HWP_DATABASE.articles.map((a) => a.id));

const taken = new Set();
if (fs.existsSync(DRAFTS)) {
  for (const d of fs.readdirSync(DRAFTS)) {
    taken.add(d);
    try { taken.add(slugify(JSON.parse(fs.readFileSync(path.join(DRAFTS, d, "brief.json"), "utf8")).topic || "")); } catch {}
  }
}

const files = fs.existsSync(LEADS) ? fs.readdirSync(LEADS).filter((f) => f.endsWith(".json")).sort().reverse() : [];
for (const f of files.slice(0, 3)) {
  const j = JSON.parse(fs.readFileSync(path.join(LEADS, f), "utf8"));
  const leads = (j.leads || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  for (const l of leads) {
    const slug = slugify(l.title);
    if (taken.has(slug) || published.has(slug)) continue;
    console.log(JSON.stringify({ url: l.url, pillar: l.pillar, topic: l.title, slug, source: l.source, file: f }));
    process.exit(0);
  }
}
console.error("nenhuma pauta nova hoje — a rodada termina após coletar e checar");
process.exit(1);
