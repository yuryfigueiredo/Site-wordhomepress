/* set-affiliate-tag.js — troca a Store ID da Amazon em todo o site de uma vez.
   A tag aparece em ~260 URLs (resultados de busca, Audible, Kindle Unlimited e
   botões de review); trocar à mão é convite a erro. Este script troca só o
   valor de `tag=`, não toca em dist/ nem em histórico.

   Uso:
     node tools/set-affiliate-tag.js meusite-20          # troca de verdade
     node tools/set-affiliate-tag.js meusite-20 --dry    # só mostra o que faria
*/
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const NOVO = process.argv[2];
const DRY = process.argv.includes("--dry");

if (!NOVO || !/^[a-z0-9][a-z0-9-]*-\d\d$/.test(NOVO)) {
  console.error("uso: node tools/set-affiliate-tag.js <store-id> [--dry]");
  console.error("a Store ID da Amazon tem a forma nome-do-site-20 (ex.: homeworldpres-20)");
  process.exit(2);
}

const IGNORAR = new Set([".git", "dist", ".audit", "node_modules", ".qoder", ".codegraph", "pipeline", "voice", "tools", "_site"]);
const EXT = new Set([".html", ".htm", ".js", ".json", ".xml", ".txt"]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

/* Só `?tag=`/`&tag=` dentro de URL — um `gtag=` de analytics ou um `data-tag=`
   não pode ser tocado. */
const TAG = /([?&])tag=([A-Za-z0-9-]+)/g;
const arquivos = walk(ROOT);
const antigas = new Map();
const alvos = [];

for (const f of arquivos) {
  const txt = fs.readFileSync(f, "utf8");
  const achadas = [...txt.matchAll(TAG)].map((m) => m[2]);
  if (!achadas.length) continue;
  for (const t of achadas) antigas.set(t, (antigas.get(t) || 0) + 1);
  if (achadas.some((t) => t !== NOVO)) alvos.push({ f, txt, n: achadas.filter((t) => t !== NOVO).length });
}

if (!alvos.length) {
  console.log(`nada a fazer: todos os links já usam tag=${NOVO}`);
  process.exit(0);
}

const resumo = [...antigas.entries()].map(([t, n]) => `${t} (${n})`).join(", ");
console.log(`tags encontradas hoje: ${resumo}`);
console.log(`${DRY ? "faria" : "vai fazer"} a troca em ${alvos.length} arquivo(s):`);

let total = 0;
for (const a of alvos) {
  const novo = a.txt.replace(TAG, (m, sep, t) => (t === NOVO ? m : `${sep}tag=${NOVO}`));
  total += a.n;
  console.log(`  ${path.relative(ROOT, a.f).padEnd(28)} ${a.n} link(s)`);
  if (!DRY) fs.writeFileSync(a.f, novo);
}

console.log(`\n${DRY ? "seriam" : "foram"} ${total} link(s) trocados para tag=${NOVO}`);
if (!DRY) {
  console.log("voltar atrás: git checkout -- .   (se já commitou: git revert <commit>)");
  console.log("conferir: node tools/doctor.js --quick");
}
