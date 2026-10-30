/* Monta dist/ com o que vai para o ar — manifesto explícito, nada de "copiar a pasta toda".
   Uso: node tools/build-dist.js  */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

/* Diretórios inteiros que são site. */
const ASSET_DIRS = ["css", "js", "images", "dumarest"];

/* Arquivos de trabalho: nunca vão para o ar. Se um aparecer no dist, é erro. */
const NEVER = [
  ".gitignore",
  "PROJECT_BLUEPRINT.md",
  "dburls.txt",
  "urls.txt",
  "wiki_plan.yaml",
];

const NEVER_DIRS = [".git", ".audit", ".codegraph", ".qoder", "tools", "pipeline", "voice", "node_modules", "dist"];

function isHtml(file) {
  return /\.html?$/i.test(file);
}

/* tools/make-stubs.js gera contorno para o GitHub Pages, que nao le
   _redirects: meta refresh + noindex. Em Workers/Vercel o 301 nativo faz o
   mesmo trabalho e manda; o stub so brigaria com ele. Nao vai no pacote. */
function isPagesStub(rel) {
  const body = fs.readFileSync(path.join(ROOT, rel), "utf8").slice(0, 1200);
  return /http-equiv="refresh"/i.test(body);
}

/* Para o redirect nativo cobrir um stub, a URL do stub tem de aparecer como
   source/linha em vercel.json e _redirects. Sem isso, tirar o stub do pacote
   transforma uma URL histórica viva em 404. */
const redirectText = ["vercel.json", "_redirects"]
  .filter((f) => fs.existsSync(path.join(ROOT, f)))
  .map((f) => fs.readFileSync(path.join(ROOT, f), "utf8"))
  .join("\n");

function stubTarget(rel) {
  const body = fs.readFileSync(path.join(ROOT, rel), "utf8").slice(0, 1200);
  const m = body.match(/url=([^"'&>]+)/i);
  if (!m) return null;
  const dir = path.posix.dirname(rel);
  return path.posix.normalize(path.posix.join(dir, m[1].trim()));
}

function rootHtmlFiles() {
  return fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isFile() && isHtml(e.name) && !NEVER.includes(e.name))
    .map((e) => e.name)
    .sort();
}

function rootExtras() {
  return ["_redirects", "vercel.json", "robots.txt", "sitemap.xml", ".htaccess"].filter((f) => fs.existsSync(path.join(ROOT, f)));
}

function walk(relDir, out) {
  for (const e of fs.readdirSync(path.join(ROOT, relDir), { withFileTypes: true })) {
    const rel = `${relDir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (!NEVER.includes(e.name)) out.push(rel);
  }
}

function copy(rel) {
  const src = path.join(ROOT, rel);
  const dst = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return fs.statSync(src).size;
}

function listFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

fs.rmSync(DIST, { recursive: true, force: true });

const candidates = [...rootHtmlFiles(), ...rootExtras()];
for (const dir of ASSET_DIRS) if (fs.existsSync(path.join(ROOT, dir))) walk(dir, candidates);

const stubsSkipped = candidates.filter((f) => isHtml(f) && isPagesStub(f));
const files = candidates.filter((f) => !stubsSkipped.includes(f));

let bytes = 0;
for (const rel of files) bytes += copy(rel);

/* Validação do pacote. */
const problems = [];
const shipped = listFiles(DIST).map((f) => path.relative(DIST, f).replace(/\\/g, "/"));
if (!shipped.includes("index.html")) problems.push("dist sem index.html");
if (!shipped.includes("404.html")) problems.push("dist sem 404.html");
for (const banned of NEVER) if (shipped.some((f) => f === banned)) problems.push(`arquivo de trabalho vazou no dist: ${banned}`);
for (const d of NEVER_DIRS) if (shipped.some((f) => f.split("/")[0] === d)) problems.push(`diretório privado vazou no dist: ${d}`);
for (const f of shipped.filter(isHtml)) {
  const body = fs.readFileSync(path.join(DIST, f), "utf8");
  if (/src="\/(?!\/)/.test(body) || /href="\/(?!\/)[^"]*\.(css|js)"/.test(body))
    problems.push(`${f} usa caminho absoluto de asset (quebra em subdomínio de preview)`);
}
const pages = shipped.filter(isHtml).length;
if (pages < 10) problems.push(`só ${pages} páginas no pacote — parece incompleto`);
for (const stub of stubsSkipped) {
  if (!redirectText.includes(stub))
    problems.push(`${stub} saiu do pacote mas nenhuma regra de 301 cobre essa URL — ficaria 404`);
}

/* ":path*" casa com zero segmentos: source "/review.html/:path*" engole o
   proprio "/review.html" e a pagina redireciona para si mesma em loop. */
if (fs.existsSync(path.join(ROOT, "vercel.json"))) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
    for (const r of cfg.redirects || []) {
      const src = r.source.replace(/\/:(path|next)\*$/, "").replace(/:.*$/, "");
      if (src === r.destination) problems.push(`regra em loop: ${r.source} -> ${r.destination}`);
    }
  } catch (e) {
    problems.push(`vercel.json nao e JSON valido: ${e.message}`);
  }
}

const mb = (bytes / 1024 / 1024).toFixed(2);
console.log(`dist/ montado: ${shipped.length} arquivos, ${pages} páginas, ${mb} MB`);
if (problems.length) {
  for (const p of problems) console.log(`  ERRO: ${p}`);
  process.exit(1);
}
console.log("  pacote validado, pronto para upload");
if (stubsSkipped.length) console.log(`  ${stubsSkipped.length} stubs do GitHub Pages fora do pacote (301 nativo faz isso)`);

/* O pacote precisa ser identico no seu PC e no CI da Vercel: se la faltar
   dumarest/ ou sobrar vercel.json, o site publicado nao e o site testado. */
if (process.env.CI) {
  const missing = files.filter((f) => !fs.existsSync(path.join(DIST, f)));
  if (missing.length) {
    console.log(`  ERRO: ${missing.length} arquivos do manifesto nao foram copiados:`);
    for (const m of missing.slice(0, 10)) console.log(`    - ${m}`);
    process.exit(1);
  }
  console.log(`  CI: ${files.length} arquivos do manifesto conferidos`);
}
