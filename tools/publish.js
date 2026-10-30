/* publish.js — publica um rascunho aprovado. Só roda com check-post verde.
   Calcula a nota, insere no catálogo, reconstrói feeds/capa e sitemap, roda o
   doctor, atualiza a memória anti-repetição e faz commit local.
   Nunca faz push, nunca faz deploy.

   Uso: node tools/publish.js <slug> [--offline] [--force-cadence]           */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SLUG = process.argv[2];
const OFFLINE = process.argv.includes("--offline") ? ["--offline"] : [];
if (!SLUG || !/^[a-z0-9-]+$/.test(SLUG)) {
  console.error("uso: node tools/publish.js <slug>");
  process.exit(2);
}
const run = (script, args = []) => execFileSync(process.execPath, [path.join(ROOT, "tools", script), ...args], { cwd: ROOT, stdio: "pipe" }).toString();

const DIR = path.join(ROOT, "pipeline", "drafts", SLUG);
const draft = JSON.parse(fs.readFileSync(path.join(DIR, "draft.json"), "utf8"));

/* ── teto de cadência: quantas matérias podem subir por dia ───────────── */
const cadence = JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "cadence.json"), "utf8"));
const LOG_FILE = path.join(ROOT, "pipeline", "state", "publish-log.json");
const today = new Date().toISOString().slice(0, 10);
let log = { days: {} };
try { log = JSON.parse(fs.readFileSync(LOG_FILE, "utf8")); } catch {}
const doneToday = (log.days || {})[today] || 0;
if (doneToday >= cadence.max_publishes_per_day && !process.argv.includes("--force-cadence")) {
  console.error(`cadência: ${doneToday}/${cadence.max_publishes_per_day} publicação(ões) hoje (${today}).`);
  console.error("O teto existe para o site não virar fábrica de conteúdo — o robô continua checando fontes nas próximas rodadas.");
  console.error("Para publicar mesmo assim: node tools/publish.js " + SLUG + " --force-cadence");
  process.exit(1);
}

try {
  execFileSync(process.execPath, [path.join(ROOT, "tools", "check-post.js"), SLUG, ...OFFLINE], { cwd: ROOT, stdio: "pipe" });
} catch (err) {
  console.error("check-post reprovou — publicação abortada. Leia pipeline/drafts/" + SLUG + "/review.md");
  process.exit(1);
}

/* ── a nota: calculada por rubrica, não declarada pelo modelo ─────────── */
const SCORES_FILE = path.join(ROOT, "pipeline", "scores.json");
const scoresBackup = fs.existsSync(SCORES_FILE) ? fs.readFileSync(SCORES_FILE, "utf8") : null;
let scoreOut = "";
try {
  scoreOut = run("score.js", ["--draft", SLUG, "--record"]);
} catch (err) {
  console.error("score.js falhou — publicação abortada:\n" + (err.stdout || err.message));
  process.exit(1);
}
const score = JSON.parse(fs.readFileSync(path.join(DIR, "score.json"), "utf8"));
if (score.duplicate) {
  console.error("nota calculada indica quase-duplicata de matéria já publicada — publicação abortada.");
  console.error(scoreOut);
  process.exit(1);
}
console.log(scoreOut.trim());

const DB_FILE = path.join(ROOT, "js", "articles-db.js");
const backup = fs.readFileSync(DB_FILE, "utf8");

const entry = {
  id: draft.id,
  title: draft.title,
  kicker: draft.kicker,
  category: draft.category,
  subtopic: draft.subtopic,
  author: draft.author,
  role: draft.role || null,
  date: draft.date,
  readTime: draft.readTime,
  isHeroLead: false,
  image: draft.image,
  imageAlt: draft.imageAlt || null,
  bookCover: draft.bookCover || null,
  dek: draft.dek,
  affiliateBox: draft.affiliateBox || null,
  content: draft.content,
  sources: Array.isArray(draft.sources) ? draft.sources : [],
  evidenceLevel: draft.evidence_level || null,
};
const serialized = JSON.stringify(entry, null, 2)
  .split("\n")
  .map((l, i) => (i ? "    " + l : l))
  .join("\n");

const anchor = backup.match(/\n(\s*)articles:\s*\[/);
if (!anchor) {
  console.error("não achei o array articles: em js/articles-db.js — nada foi alterado");
  process.exit(1);
}
const insertAt = backup.indexOf("[", anchor.index) + 1;
fs.writeFileSync(DB_FILE, backup.slice(0, insertAt) + `\n${serialized},` + backup.slice(insertAt));

const abort = (why) => {
  fs.writeFileSync(DB_FILE, backup);
  if (scoresBackup !== null) fs.writeFileSync(SCORES_FILE, scoresBackup);
  else if (fs.existsSync(SCORES_FILE)) fs.unlinkSync(SCORES_FILE);
  console.error(`${why} — catálogo e notas restaurados, nada publicado`);
  process.exit(1);
};

let buildLog = "";
try {
  buildLog += run("build.js");
  buildLog += run("build-sitemap.js");
} catch (err) {
  abort(`build falhou: ${err.message}`);
}
try {
  execFileSync(process.execPath, [path.join(ROOT, "tools", "doctor.js"), "--offline"], { cwd: ROOT, stdio: "pipe" });
} catch (err) {
  abort("doctor encontrou erros depois da inserção");
}

const runsFile = path.join(ROOT, "voice", "state", "last_runs.json");
const runs = JSON.parse(fs.readFileSync(runsFile, "utf8"));
const sc = draft.self_check || {};
/* O contrato não tem campo register — quem sabe o registro é o brief. Sem
   isso a memória era gravada em runs["undefined"] e a regra anti-repetição
   nunca pegava a peça anterior. */
let REGISTER = draft.register;
try { REGISTER = JSON.parse(fs.readFileSync(path.join(DIR, "brief.json"), "utf8")).register || REGISTER; } catch {}
runs.runs[REGISTER] = {
  id: draft.id,
  date: new Date().toISOString().slice(0, 10),
  opening_move: sc.opening_move || "",
  ending_move: sc.ending_move || "",
  title_pattern: draft.title.toLowerCase().split(/\s+/).slice(0, 4).join(" "),
  humor_lines: Number(sc.humor_lines || 0),
};
runs.updated = new Date().toISOString();
fs.writeFileSync(runsFile, JSON.stringify(runs, null, 2));

log.days = log.days || {};
log.days[today] = doneToday + 1;
log.last = { id: draft.id, date: today, score: score.score };
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2) + "\n");

let commitNote = "sem repositório git: commit pulado (rode git init quando quiser histórico)";
try {
  execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: ROOT, stdio: "pipe" });
  const files = ["js/articles-db.js", "sitemap.xml", "voice/state/last_runs.json", "pipeline/scores.json", "index.html", "culture.html", "tech.html", "science.html"];
  for (const f of files) execFileSync("git", ["add", f], { cwd: ROOT, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", `publish: ${draft.title} (nota ${score.score})`], { cwd: ROOT, stdio: "pipe" });
  commitNote = "commit local criado (push não foi feito)";
} catch {}

console.log(`publicado localmente: ${draft.id} · nota ${score.score}/10`);
console.log(buildLog.trim());
console.log(commitNote);
console.log(`cadência hoje: ${log.days[today]}/${cadence.max_publishes_per_day}`);
console.log("deploy continua sendo decisão sua: nada foi enviado para nenhum servidor.");
