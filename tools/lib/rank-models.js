/* Ordena os modelos que uma chave pode usar, do mais adequado ao menos.
   Família gemini primeiro, versão maior primeiro, depois flash → flash-lite →
   pro, e preview por último. Nada de nome fixo: quando a Google aposenta um
   modelo, este ranking já entrega o seguinte.
   Os apelidos "-latest" apontam para o mais novo e entram na frente. */
function rank(names) {
  return names
    .map((n, i) => {
      const m = n.match(/^gemini-(\d+(?:\.\d+)?)-(flash-lite|flash|pro)/i);
      const apelido = n.match(/^gemini-(flash-lite|flash|pro)(-latest)?$/i);
      const variante = m ? m[2] : apelido ? apelido[1] : null;
      return {
        n,
        i,
        familia: variante ? 1 : 0,
        versao: m ? parseFloat(m[1]) : apelido ? 99 : 0,
        tipo: variante ? (/flash-lite/i.test(variante) ? 1 : /flash/i.test(variante) ? 0 : 2) : 3,
        preview: /preview|exp/i.test(n) ? 1 : 0,
      };
    })
    .sort((a, b) => b.familia - a.familia || b.versao - a.versao || a.tipo - b.tipo || a.preview - b.preview || a.i - b.i)
    .map((x) => x.n);
}

module.exports = { rank };
