/* make-stubs.js — o GitHub Pages não executa _redirects, então cada 301 que dá
   para representar como arquivo vira uma página-stub com meta refresh (o
   doctor reconhece e isenta). Regras com curinga ou caminho .php não têm
   representação estática em hospedagem nenhuma sem Workers: essas ficam
   listadas no final como perda aceita.

   Uso: node tools/make-stubs.js                                             */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const lines = fs.readFileSync(path.join(ROOT, "_redirects"), "utf8").split("\n");

const stub = (target, depth) => {
  const up = "../".repeat(depth);
  const clean = target.replace(/^\//, "");
  return `<!doctype html>
<html lang="en-US">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex,follow">
<meta http-equiv="refresh" content="0; url=${up}${clean}">
<link rel="canonical" href="https://homeworldpress.com/${clean}">
<title>Homeworld Press — moved</title>
<script>location.replace("${up}${clean}" + location.search + location.hash);</script>
</head>
<body>
<p>Moved to <a href="${up}${clean}">${target}</a>.</p>
</body>
</html>
`;
};

let feitas = 0;
const perdas = [];
for (const line of lines) {
  const m = line.match(/^\s*(\S+)\s+(\S+)\s+30\d\s*$/);
  if (!m) continue;
  const [ , from, to] = m;
  if (from.includes("*")) { perdas.push(from + " (curinga)"); continue; }
  if (/\.php/.test(from)) { perdas.push(from + " (caminho .php)"); continue; }
  const target_path = path.extname(from) ? path.join(ROOT, from.replace(/^\//, "")) : path.join(ROOT, from.replace(/^\//, "").replace(/\/$/, ""), "index.html");
  if (fs.existsSync(target_path)) {
    /* Só pula se o arquivo existente for conteúdo real; um stub antigo (com
       meta refresh) é reescrito — assim correções de template se propagam. */
    if (!/http-equiv\s*=\s*["']refresh["']/i.test(fs.readFileSync(target_path, "utf8"))) {
      perdas.push(from + " (já existe como página real)");
      continue;
    }
  }
  if (/\.x?html?$/i.test(from)) {
    fs.writeFileSync(target_path, stub(to, 0));
    feitas++;
    continue;
  }
  if (!path.extname(from)) {
    /* /culture → stub em culture/index.html: o Pages redireciona /culture para
       /culture/ e serve o stub, que devolve para /culture.html com a query. */
    fs.mkdirSync(path.dirname(target_path), { recursive: true });
    fs.writeFileSync(target_path, stub(to, 1));
    feitas++;
    continue;
  }
  perdas.push(from + " (arquivo não-HTML: só _redirects resolve)");
}

console.log(`${feitas} stub(s) de redirect criados/atualizados.`);
if (perdas.length) {
  console.log("Sem representação estática (404 amigável no Pages, sem perda em Cloudflare/Netlify):");
  for (const p of perdas) console.log("  - " + p);
}
