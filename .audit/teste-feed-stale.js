/* teste-feed-stale.js — o RSS tem de acompanhar o catálogo.
   Medido em 07/11: `feed.xml` foi commitado uma vez (06/11) e nunca mais foi
   regenerado — nem o `publish.js` o chamava, nem o doctor o conferia. Cinco
   matérias saíram e o feed continuou no Hubble, verde em todas as rodadas.
   Para um site com 2 páginas indexadas, o feed é justamente o canal pelo qual
   o robô de busca fica sabendo que existe matéria nova.

   Rodar: node .audit/teste-feed-stale.js  (exit 1 se alguma régua vazar)

   AVISO: escreve em feed.xml por alguns instantes e restaura o byte original
   na saída (exit, exceção e Ctrl+C). */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const FEED = path.join(ROOT, "feed.xml");
const original = fs.readFileSync(FEED, "utf8");
const restaurar = () => fs.writeFileSync(FEED, original);
process.on("exit", restaurar);
process.on("SIGINT", () => { restaurar(); process.exit(130); });
process.on("uncaughtException", (err) => { console.log(`  ✗ exceção: ${err.message}`); restaurar(); process.exit(1); });

let ok = 0;
let fail = 0;
function confere(nome, cond, detalhe) {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { fail++; console.log(`  ✗ ${nome}${detalhe !== undefined ? ` → ${detalhe}` : ""}`); }
}

const { buildItems, ORIGIN } = require(path.join(ROOT, "tools", "build-feed.js"));

/* ── [1] a régua de escolha ──────────────────────────────────────────── */
console.log("\n[1] buildItems()");
const itens = buildItems();
confere("devolve no máximo 10 itens", itens.length <= 10, itens.length);
confere("ordena do mais recente para o mais antigo", itens.every((it, i) => i === 0 || itens[i - 1].date >= it.date));
confere("link e guid são absolutos no host canônico (www)", itens.every((it) => it.link.startsWith(`${ORIGIN}/`) && it.guid === it.link), itens[0] && itens[0].guid);
confere("cada item tem título, descrição e pubDate", itens.every((it) => it.title && it.description && it.date instanceof Date && !isNaN(it.date)));
confere("data ilegível não entra como 1970 no topo (vai para o fim)", itens.every((it) => it.date.getFullYear() >= 2020), itens.filter((it) => it.date.getFullYear() < 2020).map((it) => it.title).join(" | ").slice(0, 90));

global.window = global.window || {};
if (!global.window.HWP_DATABASE) require(path.join(ROOT, "js", "articles-db.js"));
const DB = global.window.HWP_DATABASE;
const ids = new Set(itens.map((it) => decodeURIComponent(it.guid.split("?id=")[1] || "")));
const maisNovo = [...DB.articles].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
confere("a matéria mais nova do catálogo está no feed", ids.has(maisNovo.id), `${maisNovo.id} · ids: ${[...ids].slice(0, 4).join(", ")}`);

/* ── [2] o arquivo commitado ─────────────────────────────────────────── */
console.log("\n[2] feed.xml no disco");
const guidsNoAr = [...original.matchAll(/<guid[^>]*>([^<]+)<\/guid>/g)].map((m) => m[1]);
confere("os guids do feed são exatamente os de buildItems(), na mesma ordem", guidsNoAr.join("|") === itens.map((it) => it.guid).join("|"), `${guidsNoAr.length} no ar vs ${itens.length} na régua`);
confere("o XML é bem formado nos campos obrigatórios do RSS", /<rss version="2\.0"/.test(original) && /<lastBuildDate>[A-Z][a-z]{2},/.test(original) && /<atom:link href=/.test(original));

/* ── [3] o portão morde ──────────────────────────────────────────────── */
console.log("\n[3] doctor.js");
function rodaDoutor() {
  try {
    return { code: 0, out: execFileSync(process.execPath, [path.join(ROOT, "tools", "doctor.js"), "--offline", "--quick"], { cwd: ROOT, encoding: "utf8" }) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ""}${err.stderr || ""}` };
  }
}
confere("com o feed em dia não há erro de feed", !/ERRO\s+\[feed-stale\]/.test(rodaDoutor().out));

/* O defeito real, reproduzido: o item mais novo some do arquivo (era exatamente
   isto: publicações entravam e o feed não mudava). */
const semOMaisNovo = original.replace(/\n    <item>[\s\S]*?<\/item>/, "");
fs.writeFileSync(FEED, semOMaisNovo);
const d1 = rodaDoutor();
restaurar();
confere("feed sem a matéria mais nova = erro feed-stale", d1.code === 1 && /ERRO\s+\[feed-stale\]/.test(d1.out), (d1.out.match(/ERRO\s+\[feed-stale\][^\n]*/) || ["nenhum erro"])[0].slice(0, 130));
confere("o erro nomeia o que falta", /ERRO\s+\[feed-stale\][^\n]*/.test(d1.out) && d1.out.match(/ERRO\s+\[feed-stale\][^\n]*/)[0].includes(itens[0].title.slice(0, 24)), itens[0].title);

/* Item sobrando (feed com peça que a régua já deixou para trás). */
fs.writeFileSync(FEED, original.replace(/<guid[^>]*>[^<]*<\/guid>/, '<guid isPermaLink="false">https://www.homeworldpress.com/article.html?id=peca-que-saiu-do-feed</guid>'));
const d2 = rodaDoutor();
restaurar();
confere("item fora dos 10 mais recentes = aviso", /aviso \[feed-stale\]/.test(d2.out), (d2.out.match(/aviso \[feed-stale\][^\n]*/) || ["nenhum aviso"])[0].slice(0, 110));

/* ── [4] quem regenera o arquivo ─────────────────────────────────────── */
console.log("\n[4] amarramento");
const pubSrc = fs.readFileSync(path.join(ROOT, "tools", "publish.js"), "utf8");
confere("publish.js regenera o feed na mesma etapa do sitemap", /run\("build-sitemap\.js"\)[\s\S]{0,400}run\("build-feed\.js"\)/.test(pubSrc), "a etapa saiu do caminho de build do publish");
confere("rodar build-feed.js sozinho não exigir nada (idempotente)", (() => {
  /* Comparar bytes com core.autocrlf ligado é comparar o checkout da máquina,
     não o conteúdo: o build escreve LF e o git entrega CRLF, então a conferência
     ficava vermelha em Windows com o feed byte a byte igual. Normaliza o EOL e
     mede o que importa — o corpo do feed. */
  const semData = (s) => s.replace(/\r\n/g, "\n").replace(/<lastBuildDate>[^<]*<\/lastBuildDate>/, "");
  const antes = fs.readFileSync(FEED, "utf8");
  execFileSync(process.execPath, [path.join(ROOT, "tools", "build-feed.js")], { cwd: ROOT, encoding: "utf8" });
  const depois = fs.readFileSync(FEED, "utf8");
  fs.writeFileSync(FEED, antes);
  return semData(depois) === semData(antes);
})());
confere("requerer build-feed de outra ferramenta não reescreve o feed", (() => {
  const antes = fs.readFileSync(FEED, "utf8");
  delete require.cache[require.resolve(path.join(ROOT, "tools", "build-feed.js"))];
  require(path.join(ROOT, "tools", "build-feed.js"));
  return fs.readFileSync(FEED, "utf8") === antes;
})());

console.log(`\n${ok} conferência(s) verde, ${fail} vermelha(s)`);
process.exit(fail ? 1 : 0);
