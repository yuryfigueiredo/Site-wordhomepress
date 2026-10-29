/* new-post.js — transforma uma pauta da fila em brief + prompt pronto para colar.
   Não escreve nada: só monta o pacote que você leva para o chat.

   Uso:
     node tools/new-post.js 3                 # pauta nº 3 da fila mais recente
     node tools/new-post.js 3 --byline "Claire Sterling"
     node tools/new-post.js --url https://... --pillar science --topic "..."
   Saída: pipeline/drafts/<slug>/brief.json + prompt.md                        */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ARGS = process.argv.slice(2);
const flag = (name) => {
  const i = ARGS.indexOf(`--${name}`);
  return i >= 0 ? ARGS[i + 1] : null;
};

const WORD_COUNT = { culture: 1200, tech: 1200, science: 1100, reviews: 1600, archive: 900 };
const BYLINE = {
  "culture:authors": "Marcus Vance",
  "culture:news": "Claire Sterling",
  "culture:comics": "Julian Mercer",
  "culture:guides": "Elena Rostova",
  tech: "Devon Brooks",
  science: "Dr. Aris Thorne",
  archive: "James Gauthier",
  reviews: "Devon Brooks",
};
const SUBTOPIC_GUESS = [
  [/obituar|died|death|author.*routine|contract|royalt|publisher|publishing|varejo|market/i, "authors"],
  [/adapt|netflix|hbo|apple tv|streaming|award|hugo|nebula|film|series/i, "news"],
  [/comic|graphic novel|omnibus|cover art|illustrat|pulp/i, "comics"],
  [/reading order|box set|how to read|saga|series order/i, "guides"],
];

function latestLeads() {
  const dir = path.join(ROOT, "pipeline", "leads");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
  if (!files.length) return null;
  return JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), "utf8"));
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

function systemPrompt() {
  const md = fs.readFileSync(path.join(ROOT, "voice", "WRITER_PROMPT.md"), "utf8");
  const start = md.indexOf("## 3. System prompt");
  const end = md.indexOf("## 4.", start);
  const block = md.slice(start, end);
  const fence = block.match(/```text\n([\s\S]*?)```/);
  return fence ? fence[1].trim() : "";
}

const leads = latestLeads();
let lead = null;
const positional = ARGS.find((a) => /^\d+$/.test(a));
if (positional) {
  if (!leads) throw new Error("nenhuma fila em pipeline/leads — rode node tools/ingest.js primeiro");
  lead = leads.leads[Number(positional) - 1];
  if (!lead) throw new Error(`a fila de ${leads.generated.slice(0, 10)} tem ${leads.leads.length} pautas`);
} else {
  const url = flag("url");
  if (!url) throw new Error("uso: node tools/new-post.js <nº da pauta>  ou  --url <url> --pillar <pilar> --topic <frase>");
  lead = { url, title: flag("topic") || url, pillar: flag("pillar") || "culture", register: flag("register") || "analista", summary: flag("topic") || "", source: "manual", keywords: [] };
}

const register = { analista: "analyst", "laboratório": "lab", laboratorio: "lab", curador: "curator" }[lead.register] || "analyst";
const subtopic =
  flag("subtopic") ||
  (SUBTOPIC_GUESS.find(([re]) => re.test(`${lead.title} ${lead.summary}`)) || [null, lead.pillar === "culture" ? "news" : "concepts"])[1];
const byline = flag("byline") || BYLINE[`${lead.pillar}:${subtopic}`] || BYLINE[lead.pillar] || "Marcus Vance";
const slug = flag("slug") || slugify(lead.title);

const brief = {
  pillar: lead.pillar,
  register,
  byline,
  topic: lead.title,
  angle: flag("angle") || null,
  sources: [{ title: lead.title, url: lead.url, date: new Date().toISOString().slice(0, 10), type: "secondary" }],
  products: [],
  image: flag("image") || null,
  word_count: Number(flag("words") || WORD_COUNT[lead.pillar] || 1200),
  must_include: [],
  must_avoid: ["qualquer número, preço, data ou citação que não venha das fontes listadas"],
  meta: { lead_source: lead.source, lead_score: lead.score, subtopic, keywords: lead.keywords },
};

const lastRuns = JSON.parse(fs.readFileSync(path.join(ROOT, "voice", "state", "last_runs.json"), "utf8"));
const memory = lastRuns.runs[register];

const prompt = [
  systemPrompt(),
  "",
  "=== BRIEF DESTA PEÇA ===",
  JSON.stringify(brief, null, 2),
  "",
  "=== MEMÓRIA ANTI-REPETIÇÃO (a última peça publicada neste registro) ===",
  JSON.stringify(memory, null, 2),
  "",
  "=== REGRAS DESTA CHAMADA ===",
  `- opening_move NÃO pode ser "${memory && memory.opening_move}". ending_move NÃO pode ser "${memory && memory.ending_move}".`,
  "- Responda SOMENTE com o JSON do output contract de voice/WRITER_PROMPT.md, sem cercas de código.",
  "- Preencha self_check com valores medidos no seu próprio texto, não estimados.",
  "- Se as fontes não sustentam um número, escreva sem o número e marque evidence_level corretamente.",
].join("\n");

const dir = path.join(ROOT, "pipeline", "drafts", slug);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "brief.json"), JSON.stringify(brief, null, 2));
fs.writeFileSync(path.join(dir, "prompt.md"), prompt);

console.log(`brief e prompt prontos em pipeline/drafts/${slug}/`);
console.log(`pilar ${brief.pillar} · registro ${register} · byline ${brief.byline} · ~${brief.word_count} palavras`);
console.log("");
console.log("Próximo passo (único manual):");
console.log(`  1. cole o conteúdo de pipeline/drafts/${slug}/prompt.md no chat`);
console.log(`  2. salve a resposta (só o JSON) em pipeline/drafts/${slug}/draft.json`);
console.log(`  3. rode node tools/check-post.js ${slug}`);
