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
const mem = require("./lib/memory");
const FORCAR = process.argv.includes("--force-cadence");
const doneToday = require("./lib/cadence").publishedToday(ROOT);
if (doneToday >= cadence.max_publishes_per_day && !FORCAR) {
  console.error(`cadência: ${doneToday}/${cadence.max_publishes_per_day} publicação(ões) hoje.`);
  console.error("O teto existe para o site não virar fábrica de conteúdo — o robô continua checando fontes nas próximas rodadas.");
  console.error("Para publicar mesmo assim: node tools/publish.js " + SLUG + " --force-cadence");
  process.exit(1);
}
/* Com rodadas perto da meia-noite UTC, o teto do dia viraria licença para
   publicar duas peças em sequência: a distância mínima vale entre publicações,
   não dentro do dia. */
const horasDesde = require("./lib/cadence").horasDesdeUltimaPublicacao(ROOT);
const minimoHoras = Number(cadence.min_hours_between_publishes || 0);
if (horasDesde !== null && minimoHoras && horasDesde < minimoHoras && !FORCAR) {
  console.error(`cadência: a última matéria está no ar há ${horasDesde.toFixed(1)}h (mínimo ${minimoHoras}h) — nada publicado.`);
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
/* score.js --record já escreveu a nota quando a publicação ainda pode falhar.
   Sem devolver o arquivo, fica uma nota de uma matéria que nunca existiu — e é
   ela que o painel e o ranking mostram. */
const restaurarNotas = () => {
  if (scoresBackup !== null) fs.writeFileSync(SCORES_FILE, scoresBackup);
  else if (fs.existsSync(SCORES_FILE)) fs.unlinkSync(SCORES_FILE);
};
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

/* build.js e build-sitemap.js gravam HTML e sitemap antes do doctor rodar:
   restaurar só o catálogo deixava o site com uma matéria que não existe mais
   no banco. O snapshot cobre tudo que os dois builds tocam.
   memory.json e last_runs.json entram porque o workflow final faz `git add -A`
   com `if: always()`: se a publicação estourar depois de inserir o artigo, um
   registro órfão — ou um artigo no ar sem contabilidade nenhuma — seria
   commitado como "turno:" e empurrado mesmo com a rodada vermelha. */
const BUILD_OUTPUTS = [
  "js/articles-db.js",
  "sitemap.xml",
  "index.html",
  "culture.html",
  "tech.html",
  "science.html",
  "pipeline/state/hero-fallback.html",
  "pipeline/memory.json",
  "voice/state/last_runs.json",
  "vercel.json",
];
const snapshot = new Map(
  BUILD_OUTPUTS.map((f) => [f, fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f)) : null])
);

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

/* Conferência da inserção: o catálogo é lido pelo site com window.HWP_DATABASE,
   e a memória anti-duplicata só enxerga as fontes que estão no arquivo. Se a
   inserição sair torta ( vírgula, escaping do content), a matéria sobe sem
   sources e a fila volta a oferecer a mesma notícia amanhã — foi exatamente
   assim que guardian-september-roundup ficou invisível para o portão. */
try {
  const w = {};
  new Function("window", fs.readFileSync(DB_FILE, "utf8"))(w);
  const gravada = (w.HWP_DATABASE.articles || []).find((a) => a.id === draft.id);
  if (!gravada) throw new Error("a matéria não aparece no catálogo re-lido");
  if (!Array.isArray(gravada.sources) || gravada.sources.length !== entry.sources.length) {
    throw new Error(`sources perdidas na inserção (${gravada.sources && gravada.sources.length} ≠ ${entry.sources.length})`);
  }
  if (gravada.content !== entry.content) throw new Error("o corpo da matéria mudou durante a inserção");
} catch (err) {
  fs.writeFileSync(DB_FILE, backup);
  restaurarNotas();
  console.error(`inserção no catálogo rejeitada: ${err.message} — catálogo e notas restaurados, nada publicado`);
  process.exit(1);
}

const abort = (why) => {
  for (const [file, content] of snapshot) {
    const abs = path.join(ROOT, file);
    if (content === null) fs.rmSync(abs, { force: true });
    else fs.writeFileSync(abs, content);
  }
  /* O retrato não cobre a-<id>.html: com o catálogo já restaurado, o gerador
     apaga o arquivo da matéria que não chegou a existir. */
  try { run("meta-pages.js"); } catch {}
  if (scoresBackup !== null) fs.writeFileSync(SCORES_FILE, scoresBackup);
  else if (fs.existsSync(SCORES_FILE)) fs.unlinkSync(SCORES_FILE);
  console.error(`${why} — catálogo, HTML, sitemap e notas restaurados, nada publicado`);
  process.exit(1);
};

let buildLog = "";
try {
  buildLog += run("build.js");
  buildLog += run("build-sitemap.js");
  buildLog += run("meta-pages.js");
} catch (err) {
  abort(`build falhou: ${err.message}`);
}
try {
  execFileSync(process.execPath, [path.join(ROOT, "tools", "doctor.js"), "--offline"], { cwd: ROOT, stdio: "pipe" });
} catch (err) {
  abort("doctor encontrou erros depois da inserção");
}

const runsFile = path.join(ROOT, "voice", "state", "last_runs.json");
/* Telemetria de estilo, não portão: com o artigo já inserido no catálogo, um
   JSON quebrado aqui matava a publicação no meio e o `git add -A` do workflow
   empurrava a matéria ao ar sem commit "publish:" e sem registro. Começa do
   zero quando o arquivo não presta. */
let runs = { runs: {} };
try {
  const lido = JSON.parse(fs.readFileSync(runsFile, "utf8"));
  if (lido && typeof lido === "object" && lido.runs && typeof lido.runs === "object") runs = lido;
} catch {}
const sc = draft.self_check || {};
let BRIEF = {};
try { BRIEF = JSON.parse(fs.readFileSync(path.join(DIR, "brief.json"), "utf8")); } catch {}
/* O contrato não tem campo register — quem sabe o registro é o brief. Sem
   isso a memória era gravada em runs["undefined"] e a regra anti-repetição
   nunca pegava a peça anterior. */
const REGISTER = BRIEF.register || draft.register || "analyst";
runs.runs[REGISTER] = {
  id: draft.id,
  date: new Date().toISOString().slice(0, 10),
  opening_move: sc.opening_move || "",
  ending_move: sc.ending_move || "",
  title_pattern: draft.title.toLowerCase().split(/\s+/).slice(0, 4).join(" "),
  humor_lines: Number(sc.humor_lines || 0),
};
runs.updated = new Date().toISOString();
try {
  fs.writeFileSync(`${runsFile}.tmp`, JSON.stringify(runs, null, 2));
  fs.renameSync(`${runsFile}.tmp`, runsFile);
} catch (err) {
  abort(`registro de estilo falhou: ${String(err.message).split("\n")[0]}`);
}

const hoje = new Date().toISOString().slice(0, 10);
/* A memória é o que o teto lê: escrita aqui, versionada, e presente no runner
   em qualquer forma de publicação — local ou Actions. A URL da pauta vai junto
   com as URLs citadas, senão o pick-lead reoferece a mesma notícia amanhã.
   Estourar aqui deixaria o artigo no ar sem registro — o teto leria 0/1 e a
   rodada seguinte repetiria a fonte. abort() desfaz a publicação em vez disso. */
try {
  mem.registrarPublicacao(ROOT, [BRIEF.meta && BRIEF.meta.lead_url, ...entry.sources.map((s) => s && s.url)], draft.id, score.score);
} catch (err) {
  abort(`registro na memória falhou: ${String(err.message).split("\n")[0]}`);
}

/* Duas coisas no mesmo repositório ao mesmo tempo é normal no Actions: o job
   setup-node commita telemetria enquanto o robô publica, e o git trava o índice
   e sai com erro. Antes esse erro caía num catch mudo: o "publish:" nunca
   apareceu no histórico e o teto diário do turno seguinte leu 0/1. */
const esperaSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function gitTenta(args, tentativas = 4) {
  for (let i = 1; ; i++) {
    try {
      return execFileSync("git", args, { cwd: ROOT, stdio: "pipe" }).toString();
    } catch (err) {
      const msg = `${err.stdout || ""}${err.stderr || ""}${err.message || ""}`.trim();
      if (!/index\.lock|cannot lock ref|cannot create repository/.test(msg) || i >= tentativas) {
        throw new Error(msg.slice(0, 300));
      }
      esperaSync(2000);
    }
  }
}

let commitNote = "sem repositório git: commit pulado (rode git init quando quiser histórico)";
try {
  gitTenta(["rev-parse", "--is-inside-work-tree"]);
  const files = ["js/articles-db.js", "sitemap.xml", "voice/state/last_runs.json", "pipeline/scores.json", "pipeline/memory.json", "index.html", "culture.html", "tech.html", "science.html", "images", "vercel.json"];
  for (const f of files) gitTenta(["add", f]);
  /* glob como pathspec: o git expande e o commit cobre também órfão removido */
  gitTenta(["add", "--", "a-*.html", "r-*.html"]);
  gitTenta(["commit", "-m", `publish: ${draft.title} (nota ${score.score})`]);
  const sujeito = gitTenta(["log", "-1", "--pretty=%s"]).trim();
  commitNote = sujeito.startsWith("publish:") ? "commit local criado (push não foi feito)" : `AVISO: HEAD é "${sujeito}" — o commit "publish:" não aconteceu`;
} catch (err) {
  commitNote = `AVISO: commit local falhou: ${String(err.message).split("\n")[0]}`;
}

console.log(`publicado localmente: ${draft.id} · nota ${score.score}/10`);
console.log(buildLog.trim());
console.log(commitNote);
console.log(`cadência hoje: ${require("./lib/cadence").publishedToday(ROOT, hoje)}/${cadence.max_publishes_per_day}`);
console.log("deploy continua sendo decisão sua: nada foi enviado para nenhum servidor.");
