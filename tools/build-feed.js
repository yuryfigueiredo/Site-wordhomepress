/* build-feed.js — gera feed.xml (RSS 2.0) com os 10 artigos/reviews mais recentes.
   Uso: node tools/build-feed.js
   Saída: feed.xml na raiz do projeto (copiado para dist/ pelo build-dist.js). */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://www.homeworldpress.com";
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/* Carrega o catálogo. O guard evita trocar o global.window que outra
   ferramenta (doctor.js) já montou: articles-db.js fica no cache do require e
   não voltaria a rodar, então o DB do chamado ficaria vazio. */
global.window = global.window || {};
if (!global.window.HWP_DATABASE) require(path.join(ROOT, "js", "articles-db.js"));
const DB = global.window.HWP_DATABASE;

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/* Converte "Nov 4, 2026" em Date UTC; retorna epoch 0 se inválida. */
function parseDate(input) {
  const m = String(input || "").match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return new Date(0);
  const mon = MONTHS[m[1].slice(0, 3)];
  if (mon === undefined) return new Date(0);
  return new Date(Date.UTC(Number(m[3]), mon, Number(m[2])));
}

/* Formata Date em RFC-822 (exige pelo RSS 2.0). */
function rfc822(d) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const mons = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getUTCDay()]}, ${String(d.getUTCDate()).padStart(2, "0")} ${mons[d.getUTCMonth()]} ${d.getUTCFullYear()} 00:00:00 +0000`;
}

/* Monta os itens a partir de artigos + reviews, ordenados por data (mais recente primeiro). */
function buildItems() {
  const entries = [];

  for (const a of DB.articles) {
    entries.push({
      title: a.title,
      link: `${ORIGIN}/article.html?id=${encodeURIComponent(a.id)}`,
      description: a.dek,
      category: a.category,
      date: parseDate(a.date),
      guid: `${ORIGIN}/article.html?id=${encodeURIComponent(a.id)}`,
    });
  }

  for (const r of DB.reviews) {
    entries.push({
      title: r.title,
      link: `${ORIGIN}/review.html?id=${encodeURIComponent(r.id)}`,
      description: r.summary,
      category: "reviews",
      date: parseDate(r.updated),
      guid: `${ORIGIN}/review.html?id=${encodeURIComponent(r.id)}`,
    });
  }

  /* Ordena do mais recente para o mais antigo e limita a 10. */
  entries.sort((a, b) => b.date - a.date);
  return entries.slice(0, 10);
}

function buildFeed() {
  const items = buildItems();
  const buildDate = rfc822(new Date());

  const itemXml = items
    .map(
      (it) => `    <item>
      <title>${esc(it.title)}</title>
      <link>${esc(it.link)}</link>
      <description>${esc(it.description)}</description>
      <category>${esc(it.category)}</category>
      <guid isPermaLink="false">${esc(it.guid)}</guid>
      <pubDate>${rfc822(it.date)}</pubDate>
    </item>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Homeworld Press</title>
    <link>${ORIGIN}/</link>
    <description>Independent editorial coverage of sci-fi literature, technology, space science, and tested buyer's guides.</description>
    <language>en-us</language>
    <lastBuildDate>${buildDate}</lastBuildDate>
    <atom:link href="${ORIGIN}/feed.xml" rel="self" type="application/rss+xml"/>
${itemXml}
  </channel>
</rss>
`;
}

/* Gerar é uma coisa; conferir é outra. O doctor.js importa buildItems() para
   comparar o feed.xml commitado com o que ESTA função escolheria — two
   implementations of "quais são os 10 mais recentes" é exatamente a classe de
   defeito que deixou o RSS parado no Hubble enquanto cinco matérias novas
   saíam sem entrar no feed. */
module.exports = { buildItems, buildFeed, ORIGIN };

if (require.main === module) {
  const feedPath = path.join(ROOT, "feed.xml");
  fs.writeFileSync(feedPath, buildFeed());
  console.log(`feed.xml gerado: ${path.relative(ROOT, feedPath)}`);
}
