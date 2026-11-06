/* find-cover.js — busca foto real para o draft com candidatos de query e
   fallback Unsplash → Pexels.
   Uso: node tools/find-cover.js <slug>
   Atualiza o draft.json com a foto encontrada. Sem foto, sai 2 e deixa o
   portão do publish.js travar a publicação e abrir o alerta.
   Requer: UNSPLASH_ACCESS_KEY e/ou PEXELS_API_KEY no .env ou process.env. */

const fs = require("fs");
const path = require("path");
const { findPhotoSmart } = require("./lib/find-photo");

const ROOT = path.resolve(__dirname, "..");
const SLUG = process.argv[2];

if (!SLUG) {
  console.error("uso: node tools/find-cover.js <slug>");
  process.exit(2);
}

const draftFile = path.join(ROOT, "pipeline", "drafts", SLUG, "draft.json");
if (!fs.existsSync(draftFile)) {
  console.error(`não existe ${path.relative(ROOT, draftFile)} — rode new-post.js antes`);
  process.exit(2);
}

const draft = JSON.parse(fs.readFileSync(draftFile, "utf8"));

(async () => {
  const { foto, log } = await findPhotoSmart(SLUG, draft);
  for (const tentativa of log) {
    console.log(`query: "${tentativa.query}" → ${tentativa.attempts.join(" | ")}`);
  }

  if (foto) {
    draft.image = foto.local;
    draft.imageAlt = `${draft.title} — ${foto.credit}`;
    draft.imageAuthor = foto.author;
    fs.writeFileSync(draftFile, JSON.stringify(draft, null, 2) + "\n");
    console.log(`✓ foto encontrada: ${foto.local} (${foto.credit})`);
    process.exit(0);
  }

  console.log("✗ nenhuma foto encontrada em nenhum candidato");
  /* O log vira o corpo da issue de alerta. */
  console.log("LOG_JSON:" + JSON.stringify(log));
  process.exit(1);
})().catch((err) => {
  console.error(`erro: ${err.message}`);
  process.exit(2);
});
