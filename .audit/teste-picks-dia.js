/* teste-picks-dia.js — o bloco que se vende como TODAY'S PICKS tem de trocar
   de par todo dia.
   Medido em 07/11: os dois cards eram HTML escrito à mão com as matérias de
   29/out e 23/out — 15 dias com o mesmo par enquanto o rótulo dizia "hoje".
   A régua agora está em tools/lib/picks-rules.js (o build renderiza e o
   doctor confere com a MESMA função). Este teste roda offline, com relógio
   falsificado: nenhuma rede, nenhum arquivo reescrito.

   Rodar: node .audit/teste-picks-dia.js   (exit 1 se alguma régua vazar)      */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const picks = require(path.join(ROOT, "tools", "lib", "picks-rules"));

let ok = 0;
let fail = 0;
function confere(nome, cond, detalhe) {
  if (cond) {
    ok++;
    console.log(`  ✓ ${nome}`);
  } else {
    fail++;
    console.log(`  ✗ ${nome}${detalhe !== undefined ? ` → ${detalhe}` : ""}`);
  }
}

/* Pool sintético: 10 peças de cultura, uma por dia de 1→10 de novembro de
   2026, nota subindo com a idade para o desempate por rank ser previsível. */
const art = (i, extra = {}) => ({
  id: `p${i}`,
  title: `Peca ${i}`,
  category: "culture",
  date: `Nov ${i}, 2026`,
  image: `images/posts/p${i}.jpg`,
  rank: 6 + i / 10,
  ...extra,
});
const POOL = Array.from({ length: 10 }, (_, k) => art(k + 1));
const ids = (lista) => lista.map((a) => a.id);

/* ── [1] rotação: o par de hoje não é o de ontem ─────────────────────── */
console.log("\n[1] rotação diária");
const pares = Array.from({ length: 11 }, (_, d) => ids(picks.picksDoDia(POOL, 2, d)));
confere("11 dias seguidos dão 11 pares sem repetição em dia consecutivo", pares.slice(1).every((p, k) => p.join("|") !== pares[k].join("|")), `${pares.join(" / ")}`);
confere("o dia 0 e o dia 10 fecham o ciclo de 10 (offset volta ao topo)", pares[0].join("|") === pares[10].join("|"), `${pares[0]} vs ${pares[10]}`);
confere("cada peça do acervo aparece em algum par do ciclo", new Set(pares.flat()).size === POOL.length, new Set(pares.flat()).size);
confere("entre dois dias seguidos entra exatamente 1 peça nova e sai 1 (meia-rotação, não A→B→A)",
  pares.slice(1).every((p, k) => p.filter((id) => pares[k].includes(id)).length === 1),
  `${pares[0]} → ${pares[1]}`);
confere("o par nunca repete a mesma matéria duas vezes no mesmo dia", pares.every((p) => new Set(p).size === p.length));

/* ── [2] acervo curto: a régua avisa quando a troca é impossível ─────── */
console.log("\n[2] mínimo para a troca existir");
confere("minimoParaRotacao(2) = 3 peças", picks.minimoParaRotacao(2) === 3, picks.minimoParaRotacao(2));
confere("minimoParaRotacao(4) = 5 peças", picks.minimoParaRotacao(4) === 5, picks.minimoParaRotacao(4));
const dois = [art(1), art(2)];
const parA = ids(picks.picksDoDia(dois, 2, 0)).sort().join("|");
const parB = ids(picks.picksDoDia(dois, 2, 1)).sort().join("|");
confere("com exatamente 2 peças o 'par de amanhã' é o MESMO par (é por isso que o mínimo é n+1)", parA === parB, `${parA} vs ${parB}`);
confere("pool vazio devolve bloco vazio, sem inventar card", picks.picksDoDia([], 2, 7).length === 0);
confere("pool de 1 devolve 1 card (não duplica a mesma matéria)", ids(picks.picksDoDia([art(1)], 2, 7)).join(",") === "p1");
confere("pool não-Array não quebra", picks.picksDoDia(undefined, 2, 7).length === 0);

/* ── [3] a unidade é o dia UTC ───────────────────────────────────────── */
console.log("\n[3] diaUtc");
confere("diaUtc(0) = 0", picks.diaUtc(0) === 0);
confere("diaUtc(86400000) = 1", picks.diaUtc(86400000) === 1);
confere("23:59:59.999 ainda é o dia anterior", picks.diaUtc(86400000 - 1) === 0, picks.diaUtc(86399999));
confere("sem argumento usa o relógio de agora", picks.diaUtc() === Math.floor(Date.now() / 86400000));
confere("duas rodadas do mesmo dia UTC veem o mesmo par (troca é por dia, não por rodada)",
  ids(picks.picksDoDia(POOL, 2, picks.diaUtc(1730000000000))).join("|") === ids(picks.picksDoDia(POOL, 2, picks.diaUtc(1730000000000 + 3600000 * 5))).join("|"));

/* ── [4] tempoDeData: a ordem do pool vem das datas do catálogo ──────── */
console.log("\n[4] tempoDeData");
confere("'Nov 7, 2026' → Date.UTC(2026,10,7)", picks.tempoDeData("Nov 7, 2026") === Date.UTC(2026, 10, 7), picks.tempoDeData("Nov 7, 2026"));
confere("'Oct 29, 2026' → Date.UTC(2026,9,29)", picks.tempoDeData("Oct 29, 2026") === Date.UTC(2026, 9, 29));
confere("'Dec 1, 2025' < 'Jan 2, 2026'", picks.tempoDeData("Dec 1, 2025") < picks.tempoDeData("Jan 2, 2026"));
confere("data ausente ou lixo vira 0 (não joga a peça para o topo)", picks.tempoDeData(undefined) === 0 && picks.tempoDeData("ontem") === 0);

/* ── [5] poolDePicks: quem concorre ──────────────────────────────────── */
console.log("\n[5] poolDePicks");
const slot = { category: "culture", limit: 2 };
const misto = [
  art(1),
  art(2, { category: "tech" }),
  art(3, { image: null, bookCover: null }),
  art(4, { image: null, bookCover: "images/books/capa.jpg" }),
  art(5, { date: "Nov 9, 2026" }),
];
confere("filtra por categoria", ids(picks.poolDePicks(misto, slot)).includes("p1") && !ids(picks.poolDePicks(misto, slot)).includes("p2"));
confere("peça sem imagem não concorre (o card é feito em volta da foto)", !ids(picks.poolDePicks(misto, slot)).includes("p3"));
confere("bookCover conta como imagem", ids(picks.poolDePicks(misto, slot)).includes("p4"));
confere("desconta o que já está no hero", ids(picks.poolDePicks(misto, slot, new Set(["p1"]))).indexOf("p1") === -1);
confere("ordena pela data mais nova primeiro", ids(picks.poolDePicks(misto, slot))[0] === "p5", ids(picks.poolDePicks(misto, slot)).join(","));
const empate = [art(1, { date: "Nov 1, 2026", rank: 7 }), art(2, { date: "Nov 1, 2026", rank: 9 })];
confere("data igual desempata por nota", ids(picks.poolDePicks(empate, slot))[0] === "p2", ids(picks.poolDePicks(empate, slot)).join(","));
confere("acervo sem rank não quebra a ordem por data", ids(picks.poolDePicks(empate.map((a) => ({ ...a, date: a.date, rank: undefined })), slot)).length === 2);

/* ── [6] ler a região renderizada do index.html ──────────────────────── */
console.log("\n[6] regiao / idsDaRegiao");
const htmlFake = [
  '<!-- hwp:auto:index-hero:start --><a href="article.html?id=capa-1"></a><!-- hwp:auto:index-hero:end -->',
  '<!-- hwp:auto:index-picks:start --><a href="article.html?id=a"></a><a href="article.html?id=a"></a><a href="article.html?id=b"></a><!-- hwp:auto:index-picks:end -->',
].join("\n");
confere("extrai os ids da região entre marcadores, sem duplicar", [...picks.idsDaRegiao(htmlFake, "index-picks")].join(",") === "a,b");
confere("a ordem dos ids é a ordem dos cards", [...picks.idsDaRegiao(htmlFake, "index-picks")].join(",") === "a,b");
confere("região sem marcadores devolve vazio (e o doctor reclama, não ignora)", picks.idsDaRegiao("<p>nada</p>", "index-picks").size === 0);
confere("regiao() devolve o texto entre os marcadores", picks.regiao(htmlFake, "index-hero").includes("capa-1") && !picks.regiao(htmlFake, "index-hero").includes("id=a"));
confere("excluidasDaRotacao() desconta só o hero", [...picks.excluidasDaRotacao(htmlFake)].join(",") === "capa-1");
confere("id com caractere escapado volta decodificado", picks.idsDaRegiao('<!-- hwp:auto:x:start --><a href="article.html?id=a%20b"></a><!-- hwp:auto:x:end -->', "x").has("a b"));

/* ── [7] integração: a régua declarada nos arquivos bate com o site ──── */
console.log("\n[7] o que está no repositório");
const cadence = JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "cadence.json"), "utf8"));
const placements = JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "placements.json"), "utf8"));
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
global.window = {};
require(path.join(ROOT, "js", "articles-db.js"));
const DB = global.window.HWP_DATABASE;
require(path.join(ROOT, "tools", "lib", "catalog-notes")).aplicar(DB, ROOT);

const slotDia = (placements.slots["index.html"] || []).find((s) => s.rotacao === "dia");
confere("placements.json declara um slot com rotacao:\"dia\"", !!slotDia);
confere("picks_changes_per_day = 1 no cadence.json", Number(cadence.picks_changes_per_day) === 1, cadence.picks_changes_per_day);
if (slotDia) {
  const n = slotDia.limit || 2;
  confere(`o slot é o index-picks do index.html`, slotDia.name === "index-picks", slotDia.name);
  confere(`o slot usa o template pick-item`, slotDia.template === "pick-item", slotDia.template);
  const pool = picks.poolDePicks(DB.articles, slotDia, picks.excluidasDaRotacao(indexHtml));
  confere(`pool real (${pool.length}) ≥ mínimo para rotacionar (${picks.minimoParaRotacao(n)})`, pool.length >= picks.minimoParaRotacao(n), pool.length);
  const esperado = ids(picks.picksDoDia(pool, n, picks.diaUtc())).join("|");
  const noAr = [...picks.idsDaRegiao(indexHtml, slotDia.name)].join("|");
  confere("o par publicado hoje é o par que a régua calcula para hoje", noAr === esperado, `no ar: ${noAr || "(vazio)"} · régua: ${esperado}`);
  confere("o bloco no ar tem exatamente os cards do limit", noAr.split("|").filter(Boolean).length === n, noAr);
  const ontem = ids(picks.picksDoDia(pool, n, picks.diaUtc() - 1)).join("|");
  confere("o par de hoje difere do par de ontem (peças suficientes para isso)", noAr !== ontem, `${ontem} → ${noAr}`);
  confere("nenhum card pick-item fora dos marcadores", (indexHtml.match(/class="pick-item"/g) || []).length === (picks.regiao(indexHtml, slotDia.name).match(/class="pick-item"/g) || []).length);
  confere("nenhum hotlink de banco de imagem no bloco (o par velho apontava para unsplash.com)",
    !/https?:\/\/(?:images\.)?unsplash\.com|https?:\/\/images\.pexels\.com/.test(picks.regiao(indexHtml, slotDia.name)));
  confere("o par de hoje não repete a capa que já está no hero", !picks.excluidasDaRotacao(indexHtml).has(noAr.split("|")[0]));
}

console.log(`\n${ok} conferência(s) verde, ${fail} vermelha(s)`);
process.exit(fail ? 1 : 0);
