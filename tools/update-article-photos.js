/* update-article-photos.js — caça placas SVG no catálogo publicado e troca por
   foto real (mesma busca inteligente do find-cover.js).
   Uso: node tools/update-article-photos.js            # todas as pendentes
        node tools/update-article-photos.js <id>       # só uma
   Saída: js/articles-db.js atualizado + fotos em images/posts/. */

const fs = require("fs");
const path = require("path");
const { findPhotoSmart } = require("./lib/find-photo");

const ROOT = path.resolve(__dirname, "..");
const DB_FILE = path.join(ROOT, "js", "articles-db.js");

global.window = {};
require(path.join(ROOT, "js", "articles-db.js"));
const DB = global.window.HWP_DATABASE;

const ehFotoReal = (img) => img && /\.(jpg|jpeg|png|webp)$/i.test(img) && !img.startsWith("images/covers/");

const FILTRO = process.argv[2];
/* Resenhas também têm hero (r.image) e og:image: um hotlink remoto cai do
   mesmo jeito e o crédito do fotógrafo se perde igual. */
const pendentes = [...DB.articles, ...(DB.reviews || [])].filter(
  (a) => (FILTRO ? a.id === FILTRO : !ehFotoReal(a.image) && !ehFotoReal(a.bookCover)),
);

/* O catálogo é um objeto JS, não JSON: as entradas antigas têm chave sem
   aspas (id:, image:) e as que o publish.js insere têm ("id":). O padrão
   aceita as duas formas e a troca fica presa dentro da entrada — sem a
   janela, uma matéria sem o campo faria a regex casar na entrada seguinte. */
const janelaDaEntrada = (db, id) => {
  const ini = db.search(new RegExp(`["']?id["']?\\s*:\\s*["']${id}["']`));
  if (ini < 0) return null;
  const fimRel = db.slice(ini + 4).search(/["']?id["']?\s*:\s*["']/);
  return [ini, fimRel < 0 ? db.length : ini + 4 + fimRel];
};

const setField = (db, id, campo, valor) => {
  const janela = janelaDaEntrada(db, id);
  if (!janela) return db;
  const [ini, fim] = janela;
  const entrada = db.slice(ini, fim);
  const campoRe = new RegExp(`["']?${campo}["']?\\s*:\\s*"[^"]*"`);
  if (campoRe.test(entrada)) {
    return db.slice(0, ini) + entrada.replace(campoRe, `${campo}: ${JSON.stringify(valor)}`) + db.slice(fim);
  }
  /* Entradas antigas não têm imageAlt: o crédito do fotógrafo entra na linha
     seguinte à do campo âncora (image), preservando a indentação da entrada. */
  const ancora = new RegExp(`([\\n\\s]*)["']?image["']?\\s*:\\s*"[^"]*",`);
  const m = entrada.match(ancora);
  if (!m) return db;
  const inserir = `${m[1]}${campo}: ${JSON.stringify(valor)},`;
  /* Inserção ANTES do recuo da linha âncora: depois dele o campo novo colaria
     no image: da mesma linha. */
  const pos = ini + m.index;
  return db.slice(0, pos) + inserir + db.slice(pos);
};

(async () => {
  console.log(`${pendentes.length} matéria(s) sem foto real\n`);
  let db = fs.readFileSync(DB_FILE, "utf8");
  let atualizados = 0;
  const falhas = [];

  for (const a of pendentes) {
    console.log(`[${a.id}]`);
    const { foto, log } = await findPhotoSmart(a.id, a);
    for (const t of log) console.log(`  query: "${t.query}" → ${t.attempts.join(" | ")}`);

    if (foto) {
      const alt = `${a.title} — ${foto.credit}`;
      const novo = setField(setField(db, a.id, "image", foto.local), a.id, "imageAlt", alt);
      if (novo === db) {
        console.log("  ✗ foto achada, mas o padrão não casou no catálogo — nada gravado\n");
        falhas.push({ id: a.id, motivo: "regex do catálogo não casou" });
      } else {
        db = novo;
        atualizados++;
        console.log(`  ✓ ${foto.local} (${foto.credit})\n`);
      }
    } else {
      console.log("  ✗ nenhuma foto encontrada\n");
      falhas.push({ id: a.id, motivo: log.map((t) => t.query).join("; ") });
    }

    /* Cota grátis do Unsplash é por hora: pausa entre matérias. */
    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  if (atualizados > 0) {
    fs.writeFileSync(DB_FILE, db);
    console.log(`✓ ${atualizados} matéria(s) com foto real — rode node tools/build.js && node tools/meta-pages.js`);
  }
  if (falhas.length) {
    console.log(`\n✗ ${falhas.length} sem foto:`);
    for (const f of falhas) console.log(`  - ${f.id} (${f.motivo})`);
  }
  process.exit(falhas.length ? 1 : 0);
})().catch((err) => {
  console.error(`Erro: ${err.message}`);
  process.exit(2);
});
