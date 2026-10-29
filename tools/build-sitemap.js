/* Regenera sitemap.xml a partir do catálogo real (js/articles-db.js) + páginas estáticas.
   Uso: node tools/build-sitemap.js  */
const fs = require("fs");
const path = require("path");

global.window = {};
const ROOT = path.resolve(__dirname, "..");
require(path.join(ROOT, "js", "articles-db.js"));
const DB = global.window.HWP_DATABASE;

const ORIGIN = "https://homeworldpress.com";
const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

function toISO(input) {
  if (!input) return null;
  const m = String(input).match(/([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return /^\d{4}-\d{2}-\d{2}/.test(input) ? input.slice(0, 10) : null;
  const month = MONTHS[m[1].slice(0, 3)];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
}

const staticUrls = [
  ["/", "daily", "1.0", null],
  ["/culture.html", "daily", "0.95", null],
  ["/reviews.html", "daily", "0.95", null],
  ["/tech.html", "daily", "0.9", null],
  ["/science.html", "daily", "0.9", null],
  ["/archive.html", "weekly", "0.9", null],
  ["/dumarest/index.htm", "monthly", "0.95", null],
  ["/tarzan-centennial.html", "monthly", "0.85", null],
  ["/chance.htm", "monthly", "0.85", null],
  ["/classic-comics.html", "monthly", "0.8", null],
  ["/disclosure.html", "yearly", "0.4", null],
];

const dynamic = [
  ...DB.articles.map((a) => [`/article.html?id=${encodeURIComponent(a.id)}`, "monthly", "0.8", toISO(a.date)]),
  ...DB.reviews.map((r) => [`/review.html?id=${encodeURIComponent(r.id)}`, "monthly", "0.85", toISO(r.updated)]),
];

const body = [...staticUrls, ...dynamic]
  .map(([loc, freq, prio, lastmod]) =>
    ["  <url>", `    <loc>${ORIGIN}${loc}</loc>`, lastmod ? `    <lastmod>${lastmod}</lastmod>` : null, `    <changefreq>${freq}</changefreq>`, `    <priority>${prio}</priority>`, "  </url>"]
      .filter(Boolean)
      .join("\n")
  )
  .join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Gerado por tools/build-sitemap.js — não editar à mão. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;

fs.writeFileSync(path.join(ROOT, "sitemap.xml"), xml);
console.log(`sitemap.xml: ${staticUrls.length + dynamic.length} URLs (${DB.articles.length} articles, ${DB.reviews.length} reviews, ${staticUrls.length} static)`);
