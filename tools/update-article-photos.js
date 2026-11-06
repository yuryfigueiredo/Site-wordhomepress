/* update-article-photos.js — busca fotos reais para artigos do catálogo e atualiza articles-db.js.
   Uso: node tools/update-article-photos.js */

const fs = require("fs");
const path = require("path");
const { findPhoto } = require("./lib/find-photo");

const ROOT = path.resolve(__dirname, "..");
const DB_FILE = path.join(ROOT, "js", "articles-db.js");

/* Artigos que precisam de fotos (IDs e queries de busca). */
const ARTIGOS = [
  { id: "nasa-fights-orbital-drag-to-prolong-hubble-survival", query: "Hubble Space Telescope orbit decay NASA" },
  { id: "physicists-watch-time-emerge-without-clocks", query: "quantum physics time emergence entanglement" },
  { id: "nasa-lunar-landing-research-vehicle-test", query: "NASA lunar landing training Apollo moon" },
  { id: "artemis-i-radiation-discrepancy", query: "Artemis moon mission radiation space" },
  { id: "webb-telescope-detects-mars-sized-collisions", query: "James Webb telescope Mars collision space" },
  { id: "guardian-september-roundup-one-category-2026", query: "science fiction books literature" },
];

(async () => {
  console.log("Buscando fotos para artigos do catálogo...\n");

  let db = fs.readFileSync(DB_FILE, "utf8");
  let atualizados = 0;

  for (const artigo of ARTIGOS) {
    console.log(`[${artigo.id}]`);
    console.log(`  Query: "${artigo.query}"`);

    const foto = await findPhoto(artigo.id, artigo.query, "science");

    if (foto) {
      console.log(`  ✓ Foto encontrada: ${foto.local} (${foto.credit})`);

      /* Atualiza o campo image no articles-db.js */
      const regex = new RegExp(`("id":\\s*"${artigo.id}"[\\s\\S]*?"image":\\s*")([^"]+)(")`, "m");
      const novoDb = db.replace(regex, `$1${foto.local}$3`);

      if (novoDb !== db) {
        db = novoDb;
        atualizados++;
        console.log(`  ✓ articles-db.js atualizado\n`);
      } else {
        console.log(`  ✗ Não foi possível atualizar articles-db.js (regex não encontrou o padrão)\n`);
      }
    } else {
      console.log(`  ✗ Nenhuma foto encontrada — mantém placa SVG\n`);
    }

    /* Pequena pausa para não sobrecarregar as APIs */
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  if (atualizados > 0) {
    fs.writeFileSync(DB_FILE, db);
    console.log(`\n✓ ${atualizados} artigos atualizados com fotos reais`);
    console.log(`Rode "node tools/build.js" para regenerar o site`);
  } else {
    console.log(`\n✗ Nenhum artigo foi atualizado`);
  }
})().catch((err) => {
  console.error(`Erro: ${err.message}`);
  process.exit(1);
});
