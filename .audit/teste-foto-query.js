/* teste-foto-query.js — a foto da matéria tem de ser da matéria.
   07/11: a matéria de íons presos foi ao ar com um render genérico de
   "QUANTUM" porque a query era a manchete ("two trapped ions let") e o banco
   devolvia results[0] sem nenhuma conferência de assunto.
   Este teste é offline: o fetch é falso, nenhuma imagem é baixada e as
   legendas das candidatas são inventadas aqui — o que se mede é a decisão,
   não a API.

   Rodar: node .audit/teste-foto-query.js   (exit 1 se alguma régua vazar)     */
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const lib = require(path.join(ROOT, "tools", "lib", "find-photo"));

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

const photo = (id, alt, likes = 0) => ({
  id,
  alt_description: alt,
  description: null,
  likes,
  user: { name: `Fotógrafo ${id}` },
  urls: { regular: `https://images.unsplash.com/photo-${id}?w=1080` },
});

process.env.UNSPLASH_ACCESS_KEY = "chave-falsa-de-teste";
process.env.PEXELS_API_KEY = "chave-falsa-de-teste";

const fetchSalvo = global.fetch;
const respondeUnsplash = (resultados, total) => {
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ total, results: resultados }) });
};
const respondePexels = (fotos) => {
  global.fetch = async (url) =>
    url.includes("pexels") ? { ok: true, status: 200, json: async () => ({ photos: fotos.map((f) => ({ ...f, src: { large2x: `https://pexels.test/${f.id}.jpg` }, photographer: `Pexels ${f.id}` })) }) } : { ok: true, status: 200, json: async () => ({ total: 0, results: [] }) };
};

(async () => {
  /* ── 1. a query montada a partir da manchete não carrega numeral ────── */
  console.log("\n[1] keywords() — o que sobra de um título");
  const tituloIon = "Two Trapped Ions Let a Gauge Field Decide Whether Matter Moves";
  const q = lib.keywords(tituloIon, 4);
  confere("sem palavra-numeral na query", !/\b(two|one|three|four|five)\b/.test(q), q);
  confere("sem verbo auxiliar na query", !/\b(let|may|would|says)\b/.test(q), q);
  confere("ainda entrega 4 palavras concretas", q.split(" ").length === 4, q);

  const qTítuloVelho = lib.keywords("Artemis IV Refueling Plan Enters Its Culture", 6);
  confere("o título de 2026 não vira query vazia", qTítuloVelho.length > 0, qTítuloVelho);

  /* ── 2. photoQuery do escritor manda, a manchete é só fallback ───────── */
  console.log("\n[2] photoQueries() — ordem dos candidatos");
  const draft = {
    photoQuery: "ion trap laser laboratory vacuum",
    title: tituloIon,
    dek: "A gauge field decides whether matter moves in a two-ion crystal.",
    category: "science",
  };
  const candidatos = lib.photoQueries(draft);
  confere("a cena escrita pelo escritor é a primeira query", candidatos[0] === "ion trap laser laboratory vacuum", candidatos[0]);
  confere("a query da manchete continua como rede de segurança", candidatos.length > 1, candidatos.join(" | "));
  confere("o fallback de categoria fecha a lista", candidatos[candidatos.length - 1] === "NASA space rocket launch galaxy", candidatos[candidatos.length - 1]);
  const semCena = lib.photoQueries({ title: tituloIon, category: "science" });
  confere("sem photoQuery ainda há para onde cair", semCena.length >= 2, semCena.join(" | "));

  /* ── 3. a régua do photoQuery (a mesma que o check-post cobra) ───────── */
  console.log("\n[3] validaPhotoQuery() — o portão do editor mecânico");
  confere("cena concreta aprovada", lib.validaPhotoQuery("ion trap laser laboratory vacuum").ok === true, JSON.stringify(lib.validaPhotoQuery("ion trap laser laboratory vacuum")));
  confere("ausente reprovado", lib.validaPhotoQuery(undefined).ok === false, "undefined passou");
  confere("vazio reprovado", lib.validaPhotoQuery("   ").ok === false, "espaços passaram");
  confere("numeral pelo extenso reprovado", lib.validaPhotoQuery("two trapped ions gauge").ok === false, lib.validaPhotoQuery("two trapped ions gauge").motivo);
  confere("abstracto demais reprovado", lib.validaPhotoQuery("legacy").ok === false, lib.validaPhotoQuery("legacy").motivo);
  confere("frase inteira de manchete reprovada", lib.validaPhotoQuery("why 1970s sci fi paperback cover art value is surging today").ok === false, lib.validaPhotoQuery("why 1970s sci fi paperback cover art value is surging today").motivo);
  confere("6 palavras aprovadas", lib.validaPhotoQuery("old paperback scifi art board desk").ok === true, "6 palavras foram reprovadas");

  /* ── 4. a conferência de legenda ────────────────────────────────────── */
  console.log("\n[4] sobreposicao() — a única prova de assunto sem ver a foto");
  confere("sem legenda não há o que concluir", lib.sobreposicao("ion trap laser", null, "") === null, typeof lib.sobreposicao("ion trap laser", null, ""));
  confere("legenda que nomeia a query pontua palavra por palavra", lib.sobreposicao("ion trap laser", "Ions held in a laser trap inside a physics lab") === 3, lib.sobreposicao("ion trap laser", "Ions held in a laser trap inside a physics lab"));
  confere("página de Bíblia não pontua para íons", lib.sobreposicao("ion trap laser", "An open Bible on a wooden table") === 0, lib.sobreposicao("ion trap laser", "An open Bible on a wooden table"));
  confere("plural conta como a palavra", lib.sobreposicao("ion trap laser", "Several ions in a trap") === 2, lib.sobreposicao("ion trap laser", "Several ions in a trap"));
  confere("pedaço de palavra NÃO conta: transmission não é ion", lib.sobreposicao("ion trap", "A transmission tower at dusk") === 0, lib.sobreposicao("ion trap", "A transmission tower at dusk"));
  confere("pedaço de palavra NÃO conta: station não é ion", lib.sobreposicao("ion", "A crowded train station") === 0, lib.sobreposicao("ion", "A crowded train station"));

  /* ── 4b. empate: assunto primeiro, qualidade depois ─────────────────── */
  console.log("\n[4b] escolheMelhor() — o banco não devolve por assunto");
  const candidatas = [
    { photo: { id: "fraca" }, match: 1, likes: 2 },
    { photo: { id: "queridinha" }, match: 1, likes: 13 },
    { photo: { id: "semlegenda" }, match: null, likes: 9999 },
  ];
  confere("no mesmo match, vence a mais curtida", lib.escolheMelhor(candidatas).photo.id === "queridinha", lib.escolheMelhor(candidatas).photo.id);
  confere("mais assunto bate mais curtida", lib.escolheMelhor([{ photo: { id: "assunto" }, match: 2, likes: 0 }, { photo: { id: "famosa" }, match: 1, likes: 9000 }]).photo.id === "assunto", "curtidas passaram na frente do assunto");
  confere("sem nenhuma legenda a primeira segue de pé", lib.escolheMelhor([{ photo: { id: "uma" }, match: null, likes: 0 }, { photo: { id: "duas" }, match: null, likes: 0 }]).photo.id === "uma", "a escolha sem prova mudou de lugar");

  /* ── 4c. o limite honesto da régua ─────────────────────────────────── */
  console.log("\n[4c] polysemy — o que a prova de legenda NÃO salva");
  respondeUnsplash([photo("valvulas", "Pressure gauges and valves are shown in monochrome", 0), photo("analogicos", "gray and multicolored analog gauges", 37), photo("relogio", "a clock on a pole", 3), photo("trem", "a couple of gauges sitting on top of a rusted train", 1), photo("velocimetro", "a close up of a speedometer on a table", 1)], 400);
  const gauge = await lib.searchUnsplash("trapped ions gauge field");
  confere("palavra ambígua passa na prova com match 1 — a legenda não salva manchete", !!gauge.photo && gauge.photo.match === 1, gauge.photo && gauge.photo.match);
  confere("com match igual o desempate é curtida, não acerto de assunto", !!gauge.photo && gauge.photo.author === "Fotógrafo analogicos", gauge.photo ? gauge.photo.author : gauge.reason);

  /* ── 5. results[0] não é mais aceito no automático ──────────────────── */
  console.log("\n[5] searchUnsplash() — escolher entre 5 candidatas");
  respondeUnsplash([photo("biblia", "An open Bible on a wooden table"), photo("laboratorio", "Laser optics on an ion trap table in a quantum lab")], 40);
  const escolhida = await lib.searchUnsplash("ion trap laser laboratory");
  confere("descarta a página de Bíblia", !!escolhida.photo && !/biblia/.test(escolhida.photo.author), JSON.stringify(escolhida.photo || escolhida.reason));
  confere("fica com a foto cuja legenda nomeia a query", !!escolhida.photo && escolhida.photo.author === "Fotógrafo laboratorio", escolhida.photo && escolhida.photo.author);
  confere("a prova de assunto vai no log", !!escolhida.photo && escolhida.photo.match >= 1, escolhida.photo && escolhida.photo.match);

  respondeUnsplash([photo("biblia", "An open Bible on a wooden table"), photo("vela", "A candle on a reading book")], 12);
  const nenhuma = await lib.searchUnsplash("ion trap laser laboratory");
  confere("nenhuma legenda menciona a query → devolve motivo, não foto", nenhuma.photo === null && /nenhuma das/.test(nenhuma.reason), JSON.stringify(nenhuma));

  respondeUnsplash([photo("semlegenda", null)], 3);
  const semDados = await lib.searchUnsplash("ion trap laser laboratory");
  confere("candidata sem legenda é aceita (não há o que conferir)", !!semDados.photo && semDados.photo.match === null, JSON.stringify(semDados));

  /* ── 6. o mesmo critério no Pexels ──────────────────────────────────── */
  console.log("\n[6] searchPexels() — mesma régua, outro banco");
  respondePexels([{ id: "livro", alt: "Old book pages" }, { id: "circuito", alt: "Close-up of a circuit board" }]);
  const px = await lib.searchPexels("circuit board macro");
  confere("Pexels também escolhe pela legenda", !!px.photo && px.photo.author === "Pexels circuito", px.photo && px.photo.author);
  const pxRuim = await lib.searchPexels("ion trap laser");
  confere("Pexels recusa quando nada nomeia a query", pxRuim.photo === null, JSON.stringify(pxRuim));

  global.fetch = fetchSalvo;
  console.log(`\n${ok}/${ok + fail} conferências passaram`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  global.fetch = fetchSalvo;
  console.error(`quebrou: ${err.stack}`);
  process.exit(1);
});
