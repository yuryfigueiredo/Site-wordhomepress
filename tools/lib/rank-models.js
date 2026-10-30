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

/* Fila diversificada. O 503 do Google é "este modelo está com demanda alta",
   não "a conta está bloqueada": em 2026-10-30 os quatro flash mais novos
   caíram juntos, porque dividem a mesma capacidade. Então a fila cruza tipos
   (flash → flash-lite → pro → gemma → resto) antes de repetir o mesmo tipo,
   mantendo a nota de cada tipo. */
const ORDEM_TIPOS = ["flash", "flash-lite", "pro", "gemma", "outro"];

function tipo(n) {
  const m = n.match(/^gemini-(\d+(?:\.\d+)?)-(flash-lite|flash|pro)/i);
  const apelido = n.match(/^gemini-(flash-lite|flash|pro)(-latest)?$/i);
  const variante = m ? m[2] : apelido ? apelido[1] : null;
  return variante ? variante.toLowerCase() : /gemma/i.test(n) ? "gemma" : "outro";
}

function diversificar(nomes, teto = 6) {
  const baldes = new Map();
  for (const n of nomes) {
    const t = tipo(n);
    if (!baldes.has(t)) baldes.set(t, []);
    baldes.get(t).push(n);
  }
  const filas = [...baldes.keys()]
    .sort((a, b) => {
      const pa = ORDEM_TIPOS.indexOf(a);
      const pb = ORDEM_TIPOS.indexOf(b);
      return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
    })
    .map((k) => baldes.get(k));
  const saida = [];
  for (let onda = 0; saida.length < teto && filas.some((f) => f[onda]); onda++) {
    for (const f of filas) if (f[onda] && saida.length < teto) saida.push(f[onda]);
  }
  return saida;
}

module.exports = { rank, diversificar };
