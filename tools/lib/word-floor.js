/* word-floor.js — a régua do comprimento, numa boca só.

   O alvo é o `word_count` do brief (o `new-post.js` o escolhe por pilar, ou o
   `--words` do dono). O piso é 70% do alvo, arredondado PARA CIMA, e é o mesmo
   número em três lugares que precisam concordar porque decidem a mesma coisa:

   · `new-post.js` escreve o número no contrato (prompt.md);
   · `write.js` usa o número (i) para decidir se o texto que voltou é curto
     demais para ser aceito e (ii) para escolher a ordem da reescrita — abaixo
     do piso manda expandir, acima manda corrigir e manter o comprimento;
   · `check-post.js` reprova por `[length]` o que estiver abaixo do piso.

   Antes deste módulo as três contas eram escritas à mão e arredondavam
   diferente: `write.js` e `new-post.js` usavam `Math.round(alvo * 0.7)`, o
   `check-post.js` comparava `medido < alvo * 0.7` cru. Medido em 15/11 com o
   prompt capturado do `write.js`: alvo 1002 → 0,7×1002 = 701,4 → `round` dava
   701, e um texto de exatamente 701 palavras recebia do editor `✗ [length]` e
   do prompt simultaneamente a ordem "NÃO acrescente seções: o texto já passou
   do piso de 701". A ordem proibia o único conserto pedido — era a morte do
   redator por outra porta, e é a família que o AGENTS.md nomeia: duas
   implementações paralelas da mesma régua.

   Com `ceil` a banda some por construção: o número declarado no contrato é
   sempre >= o limiar que reprova, e nenhum comprimento passa na boca A e falha
   na boca B. Hoje todos os alvos em disco (900/1100/1200/1600) dão 70% inteiro,
   então o comportamento não muda em nenhuma matéria existente; o que muda é o
   dia em que alguém rodar `new-post.js --words 1002`.                              */
const FATOR = 0.7;

function piso(alvo) {
  const n = Number(alvo);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n * FATOR);
}

module.exports = { FATOR, piso };
