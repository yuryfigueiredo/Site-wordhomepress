/* picks-rules.js — a régua do bloco TODAY'S PICKS da home.
   O bloco se vende como "as escolhas de hoje", então hoje tem de ser um par
   diferente do de ontem. Até 07/11 ele era HTML escrito à mão: as duas peças
   continuaram as mesmas de 29/out e 23/out durante 15 dias, com hotlink de
   banco de imagem e link de afiliado que não existe no catálogo.

   build.js renderiza e doctor.js confere com ESTA mesma função — duas
   implementações de "qual é o par de hoje" é a classe de defeito que já
   fez o painel, o build e o doctor verem capas diferentes. */

/* pool: o acervo já filtrado e ordenado (mais nova primeiro).
   n: quantos cards o bloco comporta.
   diaUtc: dia corrido de 1970 — a unidade da régua é o dia, não a rodada.
   O offset anda um por dia e volta no fim da lista: rotação, nunca
   ping-pong A→B→A, e sem estado em disco (nada que o clone do runner
   precise lembrar para acertar o par de hoje). */
function picksDoDia(pool, n, diaUtc) {
  const lista = Array.isArray(pool) ? pool : [];
  if (!lista.length) return [];
  const k = Math.min(n, lista.length);
  const offset = (((diaUtc % lista.length) + lista.length) % lista.length);
  const out = [];
  for (let i = 0; i < k; i++) out.push(lista[(offset + i) % lista.length]);
  return out;
}

const diaUtc = (ms) => Math.floor((ms === undefined ? Date.now() : ms) / 86400000);

/* Para a troca diária ser possível por construção, o acervo precisa de pelo
   menos n+1 peças: com exatamente n, todo dia sai o mesmo par e a régua
   annunciaria uma troca que não existe. */
const minimoParaRotacao = (n) => n + 1;

/* Os marcadores do build, lidos de fora: é assim que o doctor.js confere o que
   está no index.html sem reimplementar a renderização. O Set devolve os ids na
   ordem em que aparecem, então comparar [...regiao] com o par calculado compara
   também a ordem dos cards. */
const marcador = (name, kind) => `<!-- hwp:auto:${name}:${kind} -->`;
const regiao = (html, name) => {
  const a = String(html).indexOf(marcador(name, "start"));
  const b = String(html).indexOf(marcador(name, "end"));
  return a >= 0 && b > a ? String(html).slice(a, b) : "";
};
const idsDaRegiao = (html, name) =>
  new Set([...regiao(html, name).matchAll(/article\.html\?id=([^&"']+)/g)].map((m) => decodeURIComponent(m[1])));

/* O pool do bloco: mesma peneira e mesma ordem que o build usa, morando aqui
   para que build.js e doctor.js consultem UMA régua. Data mais nova primeiro
   (o rótulo é "hoje"), desempate por nota; peças sem imagem não concorrem,
   porque o card é feito em volta da foto. */
const MES = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const tempoDeData = (s) => {
  const m = String(s || "").match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})/);
  return m ? Date.UTC(Number(m[3]), MES[m[1].slice(0, 3).toLowerCase()], Number(m[2])) : 0;
};

function poolDePicks(articles, slot, excluidas) {
  const taken = excluidas || new Set();
  return (articles || [])
    .filter((a) => (slot.category ? a.category === slot.category : true))
    .filter((a) => !taken.has(a.id))
    .filter((a) => a.bookCover || a.image)
    .sort((x, y) => tempoDeData(y.date) - tempoDeData(x.date) || (y.rank == null ? -1 : y.rank) - (x.rank == null ? -1 : x.rank));
}

/* Picks é bloco de descoberta, não fila de inéditas: o par de hoje pode estar
   no feed de cultura logo abaixo — no HTML escrito à mão estava (os dois ids
   apareciam 4 vezes no index.html). O que não pode é repetir na mesma tela a
   matéria que já é a capa, então só a região do hero desconta. */
const excluidasDaRotacao = (html) => idsDaRegiao(html, "index-hero");

module.exports = { picksDoDia, poolDePicks, diaUtc, minimoParaRotacao, tempoDeData, regiao, idsDaRegiao, excluidasDaRotacao };
