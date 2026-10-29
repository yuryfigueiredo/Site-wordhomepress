/* publish.js — publica um rascunho aprovado. Só roda com check-post verde.
   Insere no catálogo, reconstrói feeds e sitemap, roda o doctor, atualiza a
   memória anti-repetição e faz commit local. Nunca faz push, nunca faz deploy.

   Uso: node tools/publish.js <slug> [--offline]                              */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SLUG = process.argv[2];
const OFFLINE = process.argv.includes("--offline") ? ["--offline"] : [];
if (!SLUG) {
  console.error("uso: node tools/publish.js <slug>");
  process.exit(2);
}
const run = (script, args = []) => execFileSync(process.execPath, [path.join(ROOT, "tools", script), ...args], { cwd: ROOT, stdio: "pipe" }).toString();

const DIR = path.join(ROOT, "pipeline", "drafts", SLUG);
const draft = JSON.parse(fs.readFileSync(path.join(DIR, "draft.json"), "utf8"));

try {
  execFileSync(process.execPath, [path.join(ROOT, "tools", "check-post.js"), SLUG, ...OFFLINE], { cwd: ROOT, stdio: "pipe" });
} catch (err) {
  console.error("check-post reprovou — publicação abortada. Leia pipeline/drafts/" + SLUG + "/review.md");
  process.exit(1);
}

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
  bookCover: draft.bookCover || null,
  dek: draft.dek,
  affiliateBox: draft.affiliateBox || null,
  content: draft.content,
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
  console.error(`${why} — catálogo restaurado, nada publicado`);
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
runs.runs[draft.register] = {
  id: draft.id,
  date: new Date().toISOString().slice(0, 10),
  opening_move: sc.opening_move || "",
  ending_move: sc.ending_move || "",
  title_pattern: draft.title.toLowerCase().split(/\s+/).slice(0, 4).join(" "),
  humor_lines: Number(sc.humor_lines || 0),
};
runs.updated = new Date().toISOString();
fs.writeFileSync(runsFile, JSON.stringify(runs, null, 2));

let commitNote = "sem repositório git: commit pulado (rode git init quando quiser histórico)";
try {
  execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: ROOT, stdio: "pipe" });
  const files = ["js/articles-db.js", "sitemap.xml", "voice/state/last_runs.json", "index.html", "culture.html", "tech.html", "science.html"];
  for (const f of files) execFileSync("git", ["add", f], { cwd: ROOT, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", `publish: ${draft.title}`], { cwd: ROOT, stdio: "pipe" });
  commitNote = "commit local criado (push não foi feito)";
} catch {}

console.log(`publicado localmente: ${draft.id}`);
console.log(buildLog.trim());
console.log(commitNote);
console.log("deploy continua sendo decisão sua: nada foi enviado para nenhum servidor.");
