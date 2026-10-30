/* Ordena os modelos que uma chave pode usar, do mais adequado ao menos.
   Nome versionado na frente (é o que a própria API recomenda quando aposenta um
   nome antigo), versão maior primeiro, flash → flash-lite → pro, depois os
   apelidos "-latest" (podem apontar para algo lento) e por último o resto.
   Nada de nome fixo: quando a Google aposenta um modelo, o ranking se vira. */
function rank(names) {
  return names
    .map((n, i) => {
      const m = n.match(/^gemini-(\d+(?:\.\d+)?)-(flash-lite|flash|pro)/i);
      const apelido = n.match(/^gemini-(flash-lite|flash|pro)(-latest)?$/i);
      const variante = m ? m[2] : apelido ? apelido[1] : null;
      return {
        n,
        i,
        familia: m ? 2 : apelido ? 1 : 0,
        versao: m ? parseFloat(m[1]) : 0,
        tipo: variante ? (/flash-lite/i.test(variante) ? 1 : /flash/i.test(variante) ? 0 : 2) : 3,
        preview: /preview|exp/i.test(n) ? 1 : 0,
      };
    })
    .sort((a, b) => b.familia - a.familia || b.versao - a.versao || a.tipo - b.tipo || a.preview - b.preview || a.i - b.i)
    .map((x) => x.n);
}

module.exports = { rank };
