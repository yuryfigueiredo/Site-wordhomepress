/* catalog-notes.js — põe as notas medidas no catálogo, do mesmo jeito em toda
   ferramenta que lê js/articles-db.js.

   build.js fazia isso sozinho, no topo do arquivo. doctor.js conferia a meta da
   capa lendo pipeline/scores.json por conta própria, sem injetar nada — então
   qualquer régua nova que use `a.rank` (como lib/cover-rules) veria um catálogo
   sem notas e diria "nenhuma matéria passa do piso" num site com nota 7.8 no
   ar. Uma injeção só, para as duas contas baterem.                            */

const fs = require("fs");
const path = require("path");

/* rankSource === "baseline" marca o acervo anterior ao pipeline: essas matérias
   competem no feed, mas nunca viram capa gerada — o HTML escrito à mão delas
   carrega detalhes (dek, alt, botão) que o catálogo não tem. */
function aplicar(DB, root) {
  try {
    const store = JSON.parse(fs.readFileSync(path.join(root, "pipeline", "scores.json"), "utf8"));
    const scores = store.scores || {};
    for (const a of DB.articles || []) {
      const rec = scores[a.id];
      if (rec && typeof rec.score === "number") {
        a.rank = rec.score;
        a.rankNote = rec.note || "";
        a.rankSource = rec.source || "auto";
      }
    }
  } catch {}
  return DB;
}

module.exports = { aplicar };
