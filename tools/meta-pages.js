/* meta-pages.js — grava uma cópia de article.html/review.html por matéria com
   título, description, canonical, og:* e JSON-LD já escritos no HTML.

   Sem isso, todo link compartilhado no Facebook/X/WhatsApp mostrava o mesmo
   cartão genérico ("Editorial Feature") e o Googlebot, que renderiza JS,
   indexava certo mas o preview social não: o head só era escrito por
   js/app.js depois do JavaScript rodar.

   O arquivo a-<id>.html NÃO é uma URL pública: vercel.json reescreve
   /article.html?id=<id> para ele (rewrite, não redirect — a barra de
   endereço continua com a URL canônica).

   Uso: node tools/meta-pages.js           grava páginas + rewrites
        node tools/meta-pages.js --check   só compara, exit 1 se divergir */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CHECK = process.argv.includes("--check");
const ORIGIN = "https://homeworldpress.com";
const DEFAULT_OG = `${ORIGIN}/images/og-homeworldpress.png`;
const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

global.window = {};
require(path.join(ROOT, "js", "articles-db.js"));
const DB = global.window.HWP_DATABASE;

const absoluteUrl = (u) => (u ? (/^https?:\/\//i.test(u) ? u : `${ORIGIN}/${String(u).replace(/^\/+/, "")}`) : DEFAULT_OG);
const socialImage = (u) => (/\.svg$/i.test(String(u || "")) ? DEFAULT_OG : absoluteUrl(u));
const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function isoDate(input) {
  const m = String(input || "").match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 3)];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
}

function ldJson(obj) {
  /* "<" vira \u003c: um "</script>" dentro de um texto fecharia o bloco. */
  return JSON.stringify(obj, null, 2).replace(/</g, "\\u003c");
}

function headBlock({ title, description, canonical, image, jsonLd }) {
  return `  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(canonical)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Homeworld Press">
  <meta property="og:locale" content="en_US">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:image" content="${esc(image)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(image)}">
  <script type="application/ld+json">
${ldJson(jsonLd)}
  </script>`;
}

const STRIP = [
  /\s*<title>[\s\S]*?<\/title>/i,
  /\s*<meta name="description"[^>]*>/i,
  /\s*<link rel="canonical"[^>]*>/i,
  /\s*<meta (?:property="og:|name="twitter:)[^>]*>/gi,
  /\s*<!--\s*Rich Snippet[\s\S]*?-->/i,
  /\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/i,
];

function renderPage(shell, block, mountId, id) {
  const headEnd = shell.indexOf("</head>");
  let head = shell.slice(0, headEnd);
  for (const rule of STRIP) head = head.replace(rule, "");
  head = head.replace(/(<meta name="viewport"[^>]*>)/i, `$1\n${block}`);
  const withBlock = head + shell.slice(headEnd);
  /* data-id: se a cópia for aberta direto (sem ?id=), o js/app.js ainda sabe
     qual matéria renderizar em vez de cair na primeira do catálogo. */
  return withBlock.replace(new RegExp(`(<article id="${mountId}"[^>]*?)>`), `$1 data-id="${esc(id)}">`);
}

function articleMeta(a) {
  const url = `${ORIGIN}/article.html?id=${encodeURIComponent(a.id)}`;
  return headBlock({
    title: `${a.title} | Homeworld Press`,
    description: a.dek,
    canonical: url,
    image: socialImage(a.image),
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: a.title,
      description: a.dek,
      image: absoluteUrl(a.image),
      ...(isoDate(a.date) ? { datePublished: isoDate(a.date) } : {}),
      articleSection: a.kicker,
      author: { "@type": "Person", name: a.author },
      publisher: {
        "@type": "Organization",
        name: "Homeworld Press",
        url: ORIGIN,
        logo: { "@type": "ImageObject", url: DEFAULT_OG },
      },
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
    },
  });
}

function reviewMeta(r) {
  const url = `${ORIGIN}/review.html?id=${encodeURIComponent(r.id)}`;
  const rating = String(r.score || "").split("/")[0].trim();
  return headBlock({
    title: `${r.title} | Homeworld Press Hardware Lab`,
    description: r.summary,
    canonical: url,
    image: socialImage(r.image),
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Product",
      name: r.topPickName || r.title,
      description: r.summary,
      image: absoluteUrl(r.image),
      review: {
        "@type": "Review",
        name: r.title,
        reviewBody: r.summary,
        ...(rating ? { reviewRating: { "@type": "Rating", ratingValue: rating, bestRating: "10", worstRating: "0" } } : {}),
        ...(isoDate(r.updated) ? { datePublished: isoDate(r.updated) } : {}),
        author: { "@type": "Organization", name: "Homeworld Press Editorial Lab" },
        publisher: { "@type": "Organization", name: "Homeworld Press", url: ORIGIN },
      },
    },
  });
}

const articleShell = fs.readFileSync(path.join(ROOT, "article.html"), "utf8");
const reviewShell = fs.readFileSync(path.join(ROOT, "review.html"), "utf8");

const wanted = new Map();
for (const a of DB.articles) wanted.set(`a-${a.id}.html`, renderPage(articleShell, articleMeta(a), "dynamicArticleMount", a.id));
for (const r of DB.reviews) wanted.set(`r-${r.id}.html`, renderPage(reviewShell, reviewMeta(r), "dynamicReviewMount", r.id));

const existing = fs
  .readdirSync(ROOT)
  .filter((f) => /^[ar]-[a-z0-9-]+\.html$/.test(f));

const written = [];
const stale = existing.filter((f) => !wanted.has(f));
/* O git deste repositório está com core.autocrlf=true: depois de um clone os
   arquivos voltam com CRLF. Comparar sem normalizar faria o --check acusar
   divergência em tudo. */
const norm = (s) => (s == null ? null : s.replace(/\r\n/g, "\n"));
for (const [file, content] of wanted) {
  const abs = path.join(ROOT, file);
  const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
  if (norm(current) === norm(content)) continue;
  written.push(file);
  if (!CHECK) fs.writeFileSync(abs, content);
}
if (!CHECK) for (const f of stale) fs.rmSync(path.join(ROOT, f), { force: true });

/* As rewrites vivem no vercel.json: cada ?id= passa a servir o arquivo com o
   head pronto. Regeneradas do zero a partir do catálogo, então matéria
   removida não deixa regra órfã. */
const VERCEL = path.join(ROOT, "vercel.json");
const vercel = JSON.parse(fs.readFileSync(VERCEL, "utf8"));
const rules = [];
for (const a of DB.articles) {
  rules.push({ source: "/article.html", has: [{ type: "query", key: "id", value: a.id }], destination: `/a-${a.id}.html` });
}
for (const r of DB.reviews) {
  rules.push({ source: "/review.html", has: [{ type: "query", key: "id", value: r.id }], destination: `/r-${r.id}.html` });
}
/* Última regra, sem `has`: id desconhecido ou ausente cai no shell, que mostra
   a matéria mais nova ou a página de não encontrada.
   O shell não pode ficar em /article.html: o Vercel dá precedência ao arquivo
   estático e a rewrite nunca rodaria (por isso o pacote publica
   article-shell.html — ver SHELL_RENAMES em build-dist.js). */
rules.push({ source: "/article.html", destination: "/article-shell.html" });
rules.push({ source: "/review.html", destination: "/review-shell.html" });
const vercelNext = JSON.stringify({ ...vercel, rewrites: rules }, null, 2) + "\n";
const vercelCurrent = fs.readFileSync(VERCEL, "utf8");
const vercelChanged = norm(vercelNext) !== norm(vercelCurrent);
if (vercelChanged && !CHECK) fs.writeFileSync(VERCEL, vercelNext);

if (CHECK) {
  const problems = written.length + stale.length + (vercelChanged ? 1 : 0);
  for (const f of written) console.log(`  desatualizado: ${f}`);
  for (const f of stale) console.log(`  órfão: ${f}`);
  if (vercelChanged) console.log("  vercel.json: rewrites fora de sincronia com o catálogo");
  if (problems) {
    console.log(`meta-pages: ${problems} divergência(s) — rode node tools/meta-pages.js`);
    process.exit(1);
  }
  console.log(`meta-pages: ${wanted.size} páginas e ${rules.length} rewrites em dia`);
  process.exit(0);
}

console.log(
  `meta-pages: ${wanted.size} páginas (${written.length} gravada(s), ${stale.length} removida(s)) · ${rules.length} rewrites${
    vercelChanged ? " · vercel.json atualizado" : " · vercel.json já estava em dia"
  }`
);
