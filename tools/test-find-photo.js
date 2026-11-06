/* test-find-photo.js — teste rápido do módulo find-photo.
   Uso: node tools/test-find-photo.js "Hubble space telescope" */

const { findPhoto } = require("./lib/find-photo");

const query = process.argv[2] || "Hubble space telescope";

(async () => {
  console.log(`buscando: "${query}"\n`);
  const foto = await findPhoto("test", query, "science");
  if (foto) {
    console.log("✓ foto encontrada:");
    console.log(`  local: ${foto.local}`);
    console.log(`  autor: ${foto.author}`);
    console.log(`  crédito: ${foto.credit}`);
  } else {
    console.log("✗ nenhuma foto encontrada (verifique as API keys no .env)");
  }
})().catch((err) => {
  console.error(`erro: ${err.message}`);
  process.exit(1);
});
