/* resposta-json.js — uma boca só para descascar e ler o JSON que o modelo devolve.

   Por que existe: o descascalço de cerca de código estava COPIADO em quatro
   lugares — `write.js` no laço principal, `write.js` na reescrita cirúrgica,
   `check-post.js` e `score.js` ao abrir o `draft.json`. Quatro implementações
   paralelas da mesma régua é exatamente a família que `AGENTS.md` nomeia (o piso
   de palavras em `round` num tool e `ceil` noutro, o `[cover]` acusando «nenhuma
   matéria passa do piso» com 7.8 no ar).

   O que a boca única sabe e as cópias não sabiam (medido 15/11, idêntico em
   `a0fa70d` e na árvore em curso):

   · a cerca pode ser ` ```JSON ` — sem a flag `i` a cópia devolvia a resposta
     inteira ao `JSON.parse`, que estourava no «JSON» da própria linha;
   · o modelo pode escrever prosa antes ou depois do payload («Aqui está o
     artigo: {…}»). Nas quatro cópias isso era `resposta não é JSON`, que no
     `write.js` é veredito DEFINITIVO: com um redator armado só, a peça é perdida
     em 0,1 s, a rodada fecha vermelha e a pauta sai por `falha_texto` (24 h) por
     um defeito de FORMATAÇÃO, não de texto. O ramo cirúrgico, que cai no texto
     inteiro em vez de condenar, tolerava o mesmo desvio — duas bocas, dois
     pesos, mesma resposta.

   Regras, na ordem: (1) cerca no começo e no fim, com ou sem rótulo de
   linguagem, em qualquer caixa; (2) se o que sobra não é JSON, o payload é o
   primeiro `{` até o fechamento balanceado, com aspas e escapes respeitados;
   (3) JSON desbalanceado NÃO é remendado — vai ao `JSON.parse` e o motivo é o
   dele, porque inventar chave que falta é inventar matéria.

   O `motivo` é frase, não código: quem chama decide o peso (o laço principal
   condena, o ramo cirúrgico cai no texto inteiro), e é essa decisão que mora no
   chamador — aqui só se lê a resposta.                                              */

const CERCA_INICIO = /^\s*```[a-zA-Z0-9_+#.-]*[ \t]*\r?\n?/;
const CERCA_FIM = /[ \t]*\r?\n?\s*```\s*$/;

/* Retira as cercas das duas pontas. Sem `m`, sem `/g`: o que importa é o envolucro. */
function descascar(texto) {
  let s = String(texto || "");
  s = s.replace(CERCA_INICIO, "");
  s = s.replace(CERCA_FIM, "");
  return s.trim();
}

/* O primeiro `{` até o seu fechamento balanceado, contando também os `[`. Ásperas
   e escapes são respeitados porque uma chave de resposta pode conter `"}"`.       */
function corpoJson(s) {
  const inicio = s.indexOf("{");
  if (inicio === -1) return s;
  let pilha = [];
  let emString = false;
  let escapa = false;
  for (let i = inicio; i < s.length; i++) {
    const c = s[i];
    if (emString) {
      if (escapa) escapa = false;
      else if (c === "\\") escapa = true;
      else if (c === '"') emString = false;
      continue;
    }
    if (c === '"') { emString = true; continue; }
    if (c === "{" || c === "[") pilha.push(c);
    else if (c === "}" || c === "]") {
      const abre = pilha.pop();
      if (!abre) return s;
      if ((c === "}") !== (abre === "{")) return s;
      if (!pilha.length) return s.slice(inicio, i + 1);
    }
  }
  return s;
}

/* → { dados, motivo, boca }. `dados` só vem quando o JSON é de fato lido;
   `boca` diz qual dos dois caminhos o achou, para o diário não ter de adivinhar. */
function parsear(texto) {
  const casca = descascar(texto);
  try {
    return { dados: JSON.parse(casca), motivo: null, boca: "inteiro" };
  } catch (err) {
    const recorte = corpoJson(casca);
    if (recorte !== casca) {
      try {
        return { dados: JSON.parse(recorte), motivo: null, boca: "prosa-ao-redor" };
      } catch {}
    }
    return { dados: null, motivo: err.message, boca: "falhou" };
  }
}

module.exports = { descascar, corpoJson, parsear, CERCA_INICIO, CERCA_FIM };
