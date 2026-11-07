/* cover-rules.js — a única definição de "matéria que pode virar capa".

   Até 2026-11-07 este filtro estava escrito duas vezes: `pickCover()` no
   build.js usava `rank`/`rankSource` do catálogo, e o doctor.js refazia a conta
   direto em `pipeline/scores.json` + `a.image`. Os dois concordavam por sorte:
   qualquer critério novo de um lado (ex.: exigir foto local) deixaria o doctor
   verde enquanto a capa real travava no vermelho, porque ele estaria medindo
   outra coisa. Agora os dois chamam esta função.                              */

const { isoDeTexto } = require("./feeddate");

const EPOCA = Date.parse("1970-01-01T00:00:00Z");

/* pipeline/cadence.json → cover_baseline. Sem cadence.json (ou sem o campo) o
   piso é 0 e a peneira não filtra nota — comportamento que sempre foi esse. */
function pisoDaCapa(cadence) {
  const n = Number(cadence && cadence.cover_baseline);
  return Number.isFinite(n) ? n : 0;
}

/* Nota MEDIDA (não "baseline" do acervo), foto real, nota >= piso. Mais nova
   primeiro; empate de dia resolvido pela nota. A data vem de lib/feeddate, o
   mesmo parser que escreve a data da matéria — não um segundo parser. */
function elegiveis(DB, floor) {
  const ms = (a) => {
    const iso = isoDeTexto(a.date);
    return iso ? Date.parse(`${iso}T00:00:00Z`) : EPOCA;
  };
  return DB.articles
    .filter((a) => typeof a.rank === "number" && a.rankSource !== "baseline" && a.image && a.rank >= floor)
    .sort((x, y) => ms(y) - ms(x) || y.rank - x.rank);
}

module.exports = { pisoDaCapa, elegiveis };
