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
const ORIGIN = "https://www.homeworldpress.com";
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

const asArray = (x) => (Array.isArray(x) ? x : []);

/* Mesmo portão do app.js: só http(s)/relativo vira href. */
const safeHref = (u) => {
  const raw = String(u || "");
  const probe = raw.replace(/[\u0000-\u0020\u007f]/g, "");
  return /^[a-z][a-z0-9+.-]*:/i.test(probe) && !/^https?:/i.test(probe) ? "" : raw;
};

function isoDate(input) {
  const m = String(input || "").match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 3)];
  if (!month) return null;
  /* "Feb 31, 2026" passava e virava datePublished inválido no JSON-LD. */
  const day = Number(m[2]);
  const dt = new Date(Date.UTC(Number(m[3]), month - 1, day));
  if (dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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

function renderPage(shell, block, mountId, id, body) {
  const headEnd = shell.indexOf("</head>");
  let head = shell.slice(0, headEnd);
  for (const rule of STRIP) head = head.replace(rule, "");
  head = head.replace(/(<meta name="viewport"[^>]*>)/i, (m) => `${m}\n${block}`);
  const withBlock = head + shell.slice(headEnd);
  /* data-id: se a cópia for aberta direto (sem ?id=), o js/app.js ainda sabe
     qual matéria renderizar em vez de cair na primeira do catálogo.
     Substituição por função: título com "$&" ou "$1" era expandido pelo
     String.replace e corrompia o head (viewport duplicado, JSON-LD inválido). */
  return withBlock.replace(new RegExp(`(<article id="${mountId}"[^>]*?)(/?)>`), (m, open, close) => `${open} data-id="${esc(id)}">${body || ""}</article>`);
}

/* ── Conteúdo pré-renderizado ──────────────────────────────────────────── */
/* O Google indexa o que está no HTML antes do JS rodar. O shell tinha o
   <article> vazio; aqui o corpo completo da matéria vai gravado na página
   estática. O app.js detecta o conteúdo pronto e não re-renderiza. */

const bylineClean = (s) => String(s || "").replace(/^\s*by\s+/i, "").trim();

function readNextHtml(a) {
  const mesmaCategoria = DB.articles
    .filter((x) => x.id !== a.id && x.category === a.category)
    .slice(0, 3);
  if (!mesmaCategoria.length) return "";
  const cards = mesmaCategoria
    .map(
      (x) => `<a class="read-next__card" href="article.html?id=${encodeURIComponent(x.id)}" style="display:block;border:var(--border-hairline);padding:0.9rem 1rem;text-decoration:none;">
      <span class="read-next__kicker" style="display:block;font-family:var(--font-mono);font-size:0.68rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.3rem;">${esc(x.kicker)}</span>
      <span class="read-next__title" style="display:block;font-family:var(--font-display);font-weight:900;font-size:1rem;line-height:1.3;">${esc(x.title)}</span>
      <span class="read-next__meta" style="display:block;font-family:var(--font-mono);font-size:0.68rem;color:var(--text-muted);margin-top:0.45rem;">BY ${esc(bylineClean(x.author))} • ${esc(x.date)}</span>
    </a>`
    )
    .join("");
  return `<section class="read-next" aria-label="Related articles" style="margin-top:3rem;border-top:var(--border-hairline);padding-top:1.5rem;">
    <h2 class="read-next__heading" style="font-family:var(--font-display);font-size:1.1rem;font-weight:900;letter-spacing:0.06em;margin:0 0 1rem;">READ NEXT</h2>
    <div class="read-next__grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0.75rem;">${cards}</div>
  </section>`;
}

function sourcesHtml(a) {  const sources = Array.isArray(a.sources) ? a.sources.filter((s) => s && /^https?:\/\//i.test(s.url || "")) : [];
  return sources.length
    ? `<section class="article-sources">
        <h2 class="article-sources__title">Sources</h2>
        <ol>
          ${sources
            .map(
              (s) =>
                `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a>${
                  s.date ? ` <span class="article-sources__date">${esc(s.date)}</span>` : ""
                }</li>`
            )
            .join("")}
        </ol>
      </section>`
    : "";
}

function adSlotHtml(label, sub) {
  return `<div class="ad-slot-container">
        <div class="ad-slot-container__label">${label}</div>
        <div style="font-family:var(--font-mono);font-size:0.78rem;color:var(--text-secondary);">${sub}</div>
      </div>`;
}

function articleBody(a) {
  const box = a.affiliateBox;
  let verdictHtml = "";
  if (box) {
    const prosHtml = asArray(box.pros).map((p) => `<li>✓ ${esc(p)}</li>`).join("");
    const consHtml = asArray(box.cons).map((c) => `<li>✕ ${esc(c)}</li>`).join("");
    const verdictImg = a.bookCover || a.image;
    const verdictImgFit = a.bookCover ? "contain" : "cover";
    const isExternalSecondary = /^https?:\/\//i.test(box.audibleUrl || "");
    const isExternalPrimary = /^https?:\/\//i.test(box.amazonUrl || "");
    verdictHtml = `
      <!-- High-Converting WIRED + Wirecutter Affiliate Verdict Box -->
      <div class="verdict-box">
        <div class="verdict-box__ribbon">
          <span>★ ${esc(box.badge)}</span>
          <span>SCORE: ${esc(box.score)}</span>
        </div>
        <div class="verdict-box__inner">
          <img src="${esc(verdictImg || "")}" alt="${esc(box.title || a.title)}" style="width:100%;height:165px;object-fit:${verdictImgFit};background:#0d0d0d;border:var(--border-hairline);">
          <div>
            <h2 style="font-family:var(--font-display);font-size:1.3rem;font-weight:900;margin-bottom:0.35rem;">${esc(box.title)}</h2>
            <p style="font-family:var(--font-mono);font-size:0.8rem;color:var(--text-muted);margin-bottom:0.85rem;">ESTIMATED PRICE: <strong>${esc(box.price)}</strong></p>
            <div style="display:flex;flex-wrap:wrap;gap:0.65rem;">
              <a href="${esc(safeHref(box.amazonUrl || ""))}" ${isExternalPrimary ? 'target="_blank" rel="nofollow sponsored noopener"' : ""} class="btn-amazon" style="width:auto;padding:0.65rem 1.25rem;">${isExternalPrimary ? "CHECK PRICE ON AMAZON →" : "SEE OUR TESTED GUIDE →"}</a>
              <a href="${esc(safeHref(box.audibleUrl || ""))}" ${isExternalSecondary ? 'target="_blank" rel="nofollow sponsored noopener"' : ""} class="btn-secondary-dark" style="background:#111;color:#fff;padding:0.65rem 1.1rem;">TRY ON AUDIBLE / MORE →</a>
            </div>
          </div>
        </div>
        <div class="verdict-box__pros-cons" style="padding:0 1.5rem 1.25rem;">
          <div>
            <strong class="verdict-label verdict-label--pros">WHY WE RECOMMEND IT</strong>
            <ul style="list-style:none;margin-top:0.4rem;display:flex;flex-direction:column;gap:0.3rem;">${prosHtml}</ul>
          </div>
          <div>
            <strong class="verdict-label verdict-label--cons">KEEP IN MIND</strong>
            <ul style="list-style:none;margin-top:0.4rem;display:flex;flex-direction:column;gap:0.3rem;">${consHtml}</ul>
          </div>
        </div>
      </div>`;
  }

  return `
      <div class="article-header">
        <span class="kicker kicker--${esc(a.category)}">${esc(a.kicker)}</span>
        <h1 class="article-title">${esc(a.title)}</h1>
        <p class="article-dek">${esc(a.dek)}</p>
        <div class="meta-line">
          <span>BY <strong>${esc(bylineClean(a.author))}</strong></span>
          <span>•</span>
          <span>${esc(a.date)}</span>
          <span>•</span>
          <span>${esc(a.readTime)}</span>
        </div>
      </div>

      ${a.image ? `<figure style="margin-bottom:2rem;border:var(--border-hairline);">
        <img src="${esc(a.image)}" alt="${esc(a.imageAlt || a.title)}" fetchpriority="high" width="900" height="500" style="width:100%;max-height:480px;object-fit:cover;">
      </figure>` : ""}

      ${verdictHtml}

      <div class="article-prose">
        ${a.content || ""}
      </div>

      ${sourcesHtml(a)}

      ${adSlotHtml("ADVERTISEMENT // GOOGLE ADSENSE & MEDIAVINE DISPLAY SLOT (ZERO-CLS RESERVED)", "728x90 / Responsive In-Article Unit — High-RPM US Literature & Tech Contextual Placement")}

      ${readNextHtml(a)}
`;
}

function reviewBody(r) {
  const prosHtml = asArray(r.pros).map((p) => `<li>✓ ${esc(p)}</li>`).join("");
  const consHtml = asArray(r.cons).map((c) => `<li>✕ ${esc(c)}</li>`).join("");

  const matrixRowsHtml = asArray(r.matrixRows)
    .map(
      (row) => `
      <tr>
        <th scope="row">${esc(row.model)}</th>
        <td>${esc(row.bestFor)}</td>
        <td>${esc(row.spec)}</td>
        <td><strong>${esc(row.score)}</strong></td>
        <td><a href="${esc(safeHref(row.url))}" target="_blank" rel="nofollow sponsored noopener" class="btn-amazon" style="padding:0.4rem 0.7rem;width:auto;">AMAZON →</a></td>
      </tr>
    `
    )
    .join("");

  const secondaryPicksHtml = asArray(r.secondaryPicks)
    .map(
      (pick) => `
      <div class="verdict-box">
        <div class="verdict-box__ribbon">
          <span>${esc(pick.ribbon)}</span>
          <span>HOMEWORLD SCORE: ${esc(pick.score)}</span>
        </div>
        <div class="verdict-box__inner">
          <img src="${esc(safeHref(pick.image))}" alt="${esc(pick.title)}" loading="lazy" width="200" height="180" style="width:100%;height:170px;object-fit:cover;border:var(--border-hairline);" />
          <div>
            <h2 style="font-family:var(--font-display);font-size:1.45rem;font-weight:900;margin:0 0 0.35rem;border:none;padding:0;">
              ${esc(pick.title)}
            </h2>
            <p style="font-size:0.93rem;color:var(--text-secondary);margin-bottom:0.85rem;">
              ${esc(pick.summary)}
            </p>
            <a href="${esc(safeHref(pick.url))}" target="_blank" rel="nofollow sponsored noopener" class="btn-amazon" style="width:auto;padding:0.7rem 1.25rem;">
              ${esc(pick.ctaText)}
            </a>
          </div>
        </div>
      </div>
    `
    )
    .join("");

  return `
      <div class="article-header">
        <span class="kicker kicker--reviews">${esc(r.kicker || "REVIEWS // TESTED")}</span>
        <h1 class="article-title">${esc(r.title)}</h1>
        <p class="article-dek">${esc(r.summary)}</p>
        <div class="meta-line">
          <span>BY <strong>HOMEWORLD PRESS LAB TEAM</strong></span>
          <span>•</span>
          <span>${esc(r.updated || "UPDATED OCTOBER 2026")}</span>
          <span>•</span>
          <span>${esc(r.readTime || "10 MIN READ")}</span>
        </div>
      </div>

      <!-- Pick 1: Best Overall -->
      <div class="verdict-box">
        <div class="verdict-box__ribbon">
          <span>🏆 #1 ${esc(r.award)} (2026)</span>
          <span>HOMEWORLD SCORE: ${esc(String(r.score).replace("/", " / "))}</span>
        </div>
        <div class="verdict-box__inner">
          <img src="${esc(safeHref(r.image))}" alt="${esc(r.topPickName)}" fetchpriority="high" width="200" height="180" style="width:100%;height:170px;object-fit:cover;border:var(--border-hairline);" />
          <div>
            <h2 style="font-family:var(--font-display);font-size:1.45rem;font-weight:900;margin:0 0 0.35rem;border:none;padding:0;">
              ${esc(r.topPickName)}
            </h2>
            <p style="font-size:0.93rem;color:var(--text-secondary);margin-bottom:0.85rem;">
              <strong>Estimated Price Range: ${esc(r.priceRange)}.</strong> ${esc(r.summary)}
            </p>
            <div style="display:flex;flex-wrap:wrap;gap:0.65rem;">
              <a href="${esc(safeHref(r.amazonUrl))}" target="_blank" rel="nofollow sponsored noopener" class="btn-amazon" style="width:auto;padding:0.7rem 1.25rem;">
                CHECK PRICE ON AMAZON US →
              </a>
              <a href="${esc(safeHref(r.secondaryCtaUrl || "https://www.amazon.com/hz/audible/mlp/membership/plus?tag=homeworldpres-20"))}" target="_blank" rel="nofollow sponsored noopener" class="btn-secondary-dark" style="background:#111;color:#fff;width:auto;padding:0.7rem 1.1rem;">
                ${esc(r.secondaryCtaText || "TRY AUDIBLE FREE →")}
              </a>
            </div>
          </div>
        </div>
        <div class="verdict-box__pros-cons" style="padding:0 1.5rem 1.25rem;">
          <div>
            <strong class="verdict-label verdict-label--pros">PROS</strong>
            <ul style="list-style:none;margin-top:0.35rem;display:flex;flex-direction:column;gap:0.25rem;">${prosHtml}</ul>
          </div>
          <div>
            <strong class="verdict-label verdict-label--cons">CONS</strong>
            <ul style="list-style:none;margin-top:0.35rem;display:flex;flex-direction:column;gap:0.25rem;">${consHtml}</ul>
          </div>
        </div>
      </div>

      <!-- Side-by-Side Comparison Matrix -->
      <div class="article-prose">
        <h2>${esc(r.matrixTitle)}</h2>
        <div tabindex="0" role="region" aria-labelledby="ereader-matrix-caption" class="table-wrapper" style="margin-block:1.5rem;">
          <table class="comparison-table">
            <caption id="ereader-matrix-caption">
              ${esc(r.matrixCaption)}
            </caption>
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Best For</th>
                <th scope="col">Display / Spec</th>
                <th scope="col">Lab Score</th>
                <th scope="col">Check Price</th>
              </tr>
            </thead>
            <tbody>
              ${matrixRowsHtml}
            </tbody>
          </table>
        </div>
      </div>

      ${secondaryPicksHtml}

      <div class="article-prose">
        ${r.prose || ""}
      </div>

      ${adSlotHtml("ADVERTISEMENT // GOOGLE ADSENSE & MEDIAVINE DISPLAY SLOT (ZERO-CLS RESERVED)", "728x90 / Responsive Hardware Lab Unit — High-RPM US Consumer Electronics Contextual Placement")}
`;
}

function articleMeta(a) {
  const url = `${ORIGIN}/article.html?id=${encodeURIComponent(a.id)}`;
  const catLabel = String(a.category || "").charAt(0).toUpperCase() + String(a.category || "").slice(1);
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${ORIGIN}/` },
      { "@type": "ListItem", position: 2, name: catLabel, item: `${ORIGIN}/${a.category}.html` },
      { "@type": "ListItem", position: 3, name: a.title, item: url },
    ],
  };
  return headBlock({
    title: `${a.title} | Homeworld Press`,
    description: a.dek,
    canonical: url,
    image: socialImage(a.image),
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        {
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
        breadcrumbLd,
      ],
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
for (const a of DB.articles) wanted.set(`a-${a.id}.html`, renderPage(articleShell, articleMeta(a), "dynamicArticleMount", a.id, articleBody(a)));
for (const r of DB.reviews) wanted.set(`r-${r.id}.html`, renderPage(reviewShell, reviewMeta(r), "dynamicReviewMount", r.id, reviewBody(r)));

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
