/* slot-markup.js — a verdade sobre "card de slot" no HTML, em um lugar só.

   build.js escreve as regiões entre os marcadores hwp:auto e doctor.js confere
   o resultado. Um card da classe de um slot FORA dessas regiões é conteúdo que
   nenhuma rodada regenera: foi exatamente assim que CULTURE (6 cards), MOST
   RECENT (4), TECH (3) e SCIENCE (3) ficaram parados no ar enquanto o rótulo
   prometia novidade — e, pior, os ids desses cards entram na conta de
   `takenIds` do build, então o próprio slot congelava com 3 peças.

   A mesma lição tinha sido aplicada só ao TODAY'S PICKS (lib/picks-rules).
   Aqui ela vale para todo slot listado em pipeline/placements.json. */

/* O formato do marcador é UM fato para o build, o doctor e o painel. */
const marcador = (name, kind) => `<!-- hwp:auto:${name}:${kind} -->`;

/* template -> classe do <article> que ele renderiza. */
const CARD_CLASS = {
  "hero-lead": "hero-lead",
  "pick-item": "pick-item",
  "latest-item": "latest-item",
  "article-card": "article-card",
  "compact-card": "compact-card",
  "cat-feed-item": "cat-feed-item",
  "center-subfeature": "center-subfeature",
};

const cardClassOf = (template) => CARD_CLASS[template] || template;

/* [[inicio, fim], ...] de cada região automática do arquivo, já sem os
   comentários dos marcadores. */
function regioesDoArquivo(html, slots) {
  const out = [];
  for (const s of slots || []) {
    const st = marcador(s.name, "start");
    const en = marcador(s.name, "end");
    const a = String(html).indexOf(st);
    const b = String(html).indexOf(en);
    if (a >= 0 && b > a) out.push([a + st.length, b]);
  }
  return out;
}

/* Posições de cada <article class="X"> do arquivo, separadas entre dentro e
   fora das regiões automáticas. */
function cardsPorClasse(html, cls, regioes) {
  const alvo = `<article class="${cls}"`;
  const dentro = [];
  const fora = [];
  let i = -1;
  while ((i = String(html).indexOf(alvo, i + 1)) >= 0) {
    (regioes.some(([a, b]) => i >= a && i < b) ? dentro : fora).push(i);
  }
  return { dentro, fora };
}

const idDoCard = (html, pos) => {
  const fim = String(html).indexOf("</article>", pos);
  const trecho = String(html).slice(pos, fim > pos ? fim : pos + 900);
  const m = trecho.match(/article\.html\?id=([^&"']+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

/* Quantos cards aquele slot gerou na última rodada. */
function cardsNaRegiao(html, slot) {
  const regioes = regioesDoArquivo(html, [slot]);
  return cardsPorClasse(html, cardClassOf(slot.template), regioes).dentro.length;
}

/* Ids que só os blocos automáticos do arquivo já carregam, ignorando a região
   do próprio slot. É a peneira de "somente-automatico": a curadoria escrita à
   mão (TRENDING // TOP 5) pode repetir uma matéria do feed sem que isso seja
   defeito — o que não pode é a mesma peça aparecer duas vezes na MESMA tela,
   e os blocos automáticos são justamente o que divide a tela com o slot. */
function idsDentroDasRegioes(html, excetoNome) {
  const st = /<!-- hwp:auto:([^:]+):start -->/g;
  const out = new Set();
  let m;
  while ((m = st.exec(String(html)))) {
    if (m[1] === excetoNome) continue;
    const a = m.index + m[0].length;
    const b = String(html).indexOf(marcador(m[1], "end"), a);
    if (b < 0) continue;
    for (const id of String(html).slice(a, b).matchAll(/article\.html\?id=([^&"']+)/g)) out.add(decodeURIComponent(id[1]));
    st.lastIndex = b;
  }
  return out;
}

module.exports = {
  CARD_CLASS,
  cardClassOf,
  marcador,
  regioesDoArquivo,
  cardsPorClasse,
  idDoCard,
  cardsNaRegiao,
  idsDentroDasRegioes,
};
