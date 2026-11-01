/* Conferência: o texto gravado dentro da placa bate com o título do catálogo? */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
global.window = {};
require(path.join(ROOT, "js", "articles-db.js"));
const D = global.window.HWP_DATABASE;
const ids = [
  "artemis-i-radiation-discrepancy",
  "guardian-september-roundup-one-category-2026",
  "webb-telescope-detects-mars-sized-collisions",
];
const desc = (s) => String(s).replace(/&amp;/g, "&").replace(/&apos;|&#39;/g, "'").replace(/[’‘]/g, "'").replace(/[—–]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
for (const id of ids) {
  const a = D.articles.find((x) => x.id === id);
  const svg = fs.readFileSync(path.join(ROOT, a.image), "utf8");
  const placa = [...svg.matchAll(/font-weight="700" fill="#F7F6F2"[^>]*>([^<]+)</g)].map((m) => m[1]).join(" ");
  console.log(id);
  console.log("  titulo :", a.title);
  console.log("  placa  :", desc(placa) ? placa : "(sem titulo gravado)");
  console.log("  bate?  :", desc(placa) === desc(a.title) ? "SIM" : "NAO");
  console.log("  alt    :", a.imageAlt);
}
