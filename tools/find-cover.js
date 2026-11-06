/* find-cover.js — busca foto real para o draft com fallback Unsplash → Pexels.
   Uso: node tools/find-cover.js <slug>
   Atualiza o draft.json com a foto encontrada (ou mantém placa SVG se não achar).
   Requer: UNSPLASH_ACCESS_KEY e/ou PEXELS_API_KEY no .env ou process.env. */

const fs = require("fs");
const path = require("path");
const { findPhoto } = require("./lib/find-photo");

const ROOT = path.resolve(__dirname, "..");
const SLUG = process.argv[2];

if (!SLUG) {
  console.error("uso: node tools/find-cover.js <slug>");
  process.exit(2);
}

const draftFile = path.join(ROOT, "pipeline", "drafts", SLUG, "draft.json");
if (!fs.existsSync(draftFile)) {
  console.error(`não achei ${path.relative(ROOT, draftFile)} — rode new-post.js antes`);
  process.exit(1);
}

const draft = JSON.parse(fs.readFileSync(draftFile, "utf8"));

/* Query de busca: usa o título (primeiras 6 palavras) + categoria. */
const titulo = String(draft.title || "");
const query = titulo.split(/\s+/).slice(0, 6).join(" ") + " " + (draft.category || "");

(async () => {
  console.log(`buscando foto para ${SLUG}... query: "${query}"`);
  const foto = await findPhoto(SLUG, query, draft.category);

  if (foto) {
    draft.image = foto.local;
    draft.imageAlt = `${titulo} — ${foto.credit}`;
    draft.imageAuthor = foto.author;
    fs.writeFileSync(draftFile, JSON.stringify(draft, null, 2) + "\n");
    console.log(`✓ foto encontrada: ${foto.local} (${foto.credit})`);
  } else {
    console.log(`✗ nenhuma foto encontrada — mantém placa SVG`);
  }
})().catch((err) => {
  console.error(`erro: ${err.message}`);
  process.exit(1);
});
