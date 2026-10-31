/* feeddate.js — lê a data que um feed escreve, sem inventar dia.

   Três pegadinhas já pagas uma vez e que qualquer parser ingênuo repete:
   1. "Wed, 28 Oct 2026 23:06:41 EDT" virado por Date.parse em UTC vira o dia
      29. Vale o dia escrito no texto, não o instante convertido.
   2. "31 de fevereiro" (2026-02-31) rola para 03 de março e o modelo escreve a
      matéria com uma data que não existe no calendário.
   3. Feed com data no futuro (relógio do portal adiantado, ou UTC vs fuso)
      não pode virar notícia "de amanhã".

   new-post.js usa isto para a data da fonte; pick-lead.js para a idade da
   pauta; um parser só, para as duas decisões baterem.                          */
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function isoValida(y, m, d) {
  y = Number(y);
  m = Number(m);
  d = Number(d);
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  const iso = dt.toISOString().slice(0, 10);
  return iso <= new Date().toISOString().slice(0, 10) ? iso : null;
}

/* Texto cru do feed (pubDate/updated/published/dc:date) → "YYYY-MM-DD" ou null. */
function isoDeTexto(raw) {
  const texto = String(raw || "").trim();
  if (!texto) return null;
  const iso = texto.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) {
    const valida = isoValida(iso[0].slice(0, 4), iso[0].slice(5, 7), iso[0].slice(8, 10));
    if (valida) return valida;
  }
  const rfc = texto.match(/\b(\d{1,2})[\s-]+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?[\s-]+(\d{4})\b/i);
  const escrita = rfc
    ? isoValida(rfc[3], MONTHS.indexOf(rfc[2].toUpperCase()) + 1, rfc[1])
    : null;
  if (escrita) return escrita;
  const longa = texto.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i);
  const marcada = longa ? isoValida(longa[3], MONTHS.indexOf(longa[1].toUpperCase()) + 1, longa[2]) : null;
  if (marcada) return marcada;
  /* Nada escrito e reconhecível: só então o Date.parse do texto inteiro. Com
     dia escrito inválido ("31 Feb") ele rolaria para outro dia e inventaria
     uma data, então não roda quando rfc/longa/iso bateram mas venceram. */
  if (!rfc && !longa && !iso) {
    const ms = Date.parse(texto);
    if (!isNaN(ms)) {
      const dt = new Date(ms);
      if (dt.toISOString().slice(0, 10) <= new Date().toISOString().slice(0, 10)) return dt.toISOString().slice(0, 10);
    }
  }
  return null;
}

/* Quantos dias separam a fonte de hoje. null = sem data confiável. */
function idadeEmDias(raw) {
  const iso = isoDeTexto(raw);
  if (!iso) return null;
  const dias = (Date.now() - Date.parse(`${iso}T00:00:00Z`)) / 86400000;
  return dias < 0 ? null : Math.floor(dias);
}

module.exports = { isoDeTexto, isoValida, idadeEmDias };
