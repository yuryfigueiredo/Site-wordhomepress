/* teste-capa-rodada.js — prova de que a capa gira em TODA rodada.
   Relógio falso (Date global) + build.js re-requerido no mesmo processo, porque
   a rotação depende do instante e o Actions é quem chama o build.
   Roda contra os arquivos reais e DEPOIS os restaura por instantâneo de bytes
   tomado antes da primeira linha: nada aqui é para deixar rastro no repositório.
   Não é `git checkout` — ver o bloco de restauração abaixo. */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BUILD = path.join(ROOT, "tools", "build.js");
const STATE = path.join(ROOT, "pipeline", "state", "cover-state.json");
const RealDate = Date;

let offset = 0;
class FakeDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(RealDate.now() + offset);
    else super(...args);
  }
  static now() {
    return RealDate.now() + offset;
  }
}
global.Date = FakeDate;

/* Instantâneo de bytes ANTES de qualquer build, sobre tudo que o build escreve:
   as páginas de `placements.json`, o fallback da capa e o estado. A primeira
   versão restaurava por `git checkout` nos arquivos "que ficaram sujos durante
   o teste", e isso tinha dois buracos do mesmo tamanho:

   1. `index.html` está PERMANENTEMENTE marcado como modificado (core.autocrlf
      reescreve CRLF; `git diff --quiet index.html` é 0, mas o status mente),
      então ele nunca entrava na lista e o hero voltava ao lugar só porque a
      última rodada simulada caía na mesma capa do HEAD. Correto por coincidência.
   2. O checkout também jogaria fora edição sua, não commitada, de qualquer
      arquivo que o teste tocar.

   Bytes próprios, gravados de volta no `exit`, nos `signals` e na exceção sem
   catch — o mesmo padrão de `turno.js` e `publish.js`. */
const alvosDoBuild = [
  ...Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "placements.json"), "utf8")).slots),
  "pipeline/state/hero-fallback.html",
  path.relative(ROOT, STATE).split(path.sep).join("/"),
];
const instantaneos = new Map(
  alvosDoBuild
    .filter((f) => fs.existsSync(path.join(ROOT, f)))
    .map((f) => [f, fs.readFileSync(path.join(ROOT, f))])
);
let restaurado = false;
function restaurar() {
  if (restaurado) return;
  restaurado = true;
  for (const [f, bytes] of instantaneos) {
    const p = path.join(ROOT, f);
    const atual = fs.existsSync(p) ? fs.readFileSync(p) : null;
    if (!atual || !atual.equals(bytes)) fs.writeFileSync(p, bytes);
  }
  global.Date = RealDate;
}
process.on("exit", restaurar);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { restaurar(); process.exit(130); });
process.on("uncaughtException", (e) => { restaurar(); console.error(e); process.exit(1); });

/* Instantâneo do relógio real para o resto do script (restauração, leitura). */
const agoraReal = () => new RealDate();
const isoDe = (d) => d.toISOString();

/* fuso = UTC-3 fixo desde 2019: "04:23 de Brasília" é 07:23 UTC. */
const fuso = (diaFuso, hhmm) => new FakeDate(`${diaFuso}T${add3(hhmm)}:00Z`);
function add3(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const t = h + 3;
  return `${String(t % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
/* O dia UTC correspondente a um dia do fuso para horários >= 03:00 locais. */
function setRelogio(diaFuso, hhmm) {
  const inst = fuso(diaFuso, hhmm);
  offset = inst.getTime() - RealDate.now();
  return inst;
}

const heroNoAr = () => {
  const s = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const i = s.indexOf("<!-- hwp:auto:index-hero:start -->");
  const j = s.indexOf("<!-- hwp:auto:index-hero:end -->");
  const m = /article\.html\?id=([^&"']+)/.exec(s.slice(i, j));
  return m ? decodeURIComponent(m[1]) : null;
};

function rodarBuild() {
  /* build.js faz `global.window = {}` e exige js/articles-db.js: re-exigir o
     build com o articles-db ainda no cache deixaria DB undefined — o módulo não
     roda de novo. Os dois saem do cache a cada rodada simulada. */
  for (const f of [BUILD, path.join(ROOT, "js", "articles-db.js")]) {
    const resolved = require.resolve(f);
    delete require.cache[resolved];
  }
  const linhas = [];
  const original = console.log;
  console.log = (...a) => linhas.push(a.join(" "));
  let erro = null;
  try {
    require(BUILD);
  } catch (e) {
    erro = e;
  } finally {
    console.log = original;
  }
  const capa = (linhas.find((l) => /index-hero:/.test(l)) || "").trim();
  return { capa, linhas, erro };
}

const estadoNaDisco = () => JSON.parse(fs.readFileSync(STATE, "utf8"));

const falhas = [];
const checks = [];
function confere(descricao, ok, detalhe = "") {
  checks.push({ descricao, ok: Boolean(ok), detalhe });
  if (!ok) falhas.push(`${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
}

/* ── A. rodadaId: o balde da rodada ─────────────────────────────────────── */
{
  const cover = require(path.join(ROOT, "tools", "lib", "cover-state.js"));
  const esperado = { "00:23": "2026-12-01T00:23", "04:23": "2026-12-01T04:23", "08:23": "2026-12-01T08:23", "12:23": "2026-12-01T12:23", "16:23": "2026-12-01T16:23", "20:23": "2026-12-01T20:23" };
  for (const [hora, id] of Object.entries(esperado)) {
    setRelogio("2026-12-01", hora);
    confere(`rodadaId no horário ${hora} = ${id}`, cover.rodadaId() === id, `veio ${cover.rodadaId()}`);
  }
  /* Rodada atrasada (medido no Actions: 1 a 170 min) pertence ao horário que
     deveria ter rodado, não ao minuto em que o node acordou. */
  setRelogio("2026-12-01", "06:10");
  confere("rodada das 04:23 arriving 1h47 tarde conta como 04:23", cover.rodadaId() === "2026-12-01T04:23", `veio ${cover.rodadaId()}`);
  /* Antes da primeira rodada do dia ainda está em curso a última de ontem. */
  setRelogio("2026-12-01", "00:10");
  confere("00:10 pertence à rodada de 20:23 de ontem", cover.rodadaId() === "2026-11-30T20:23", `veio ${cover.rodadaId()}`);
  setRelogio("2026-12-01", "00:22");
  confere("00:22 (1 min antes) ainda é ontem", cover.rodadaId() === "2026-11-30T20:23", `veio ${cover.rodadaId()}`);
  setRelogio("2026-12-01", "00:23");
  confere("00:23 em ponto abre a rodada de hoje", cover.rodadaId() === "2026-12-01T00:23", `veio ${cover.rodadaId()}`);
}

/* O catálogo com as notas aplicadas — exatamente o que o build.js enxerga:
   `cover-rules.elegiveis` filtra por `rank`, e `rank` vem de
   lib/catalog-notes, não do js/articles-db.js cru. */
function carregarDB() {
  delete require.cache[require.resolve(path.join(ROOT, "js", "articles-db.js"))];
  global.window = {};
  require(path.join(ROOT, "js", "articles-db.js"));
  const DB = global.window.HWP_DATABASE;
  require(path.join(ROOT, "tools", "lib", "catalog-notes.js")).aplicar(DB, ROOT);
  return DB;
}
const pisoDaCapa = () =>
  require(path.join(ROOT, "tools", "lib", "cover-rules.js")).pisoDaCapa(JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "cadence.json"), "utf8")));

/* ── B. sete rodadas seguidas de build, mais um segundo build na última ──── */
const DIAS = ["2026-12-01", "2026-12-01", "2026-12-01", "2026-12-01", "2026-12-01", "2026-12-01", "2026-12-02"];
const HORAS = ["00:23", "04:23", "08:23", "12:23", "16:23", "20:23", "00:23"];
const sequencia = [];
{
  let anterior = heroNoAr();
  for (let i = 0; i < HORAS.length; i++) {
    setRelogio(DIAS[i], HORAS[i]);
    const { capa, erro } = rodarBuild();
    if (erro) {
      falhas.push(`build quebrou na rodada ${i + 1}: ${erro.message}`);
      break;
    }
    const agora = heroNoAr();
    const est = estadoNaDisco();
    const id = `${DIAS[i]}T${HORAS[i]}`;
    const daRodada = est.changes.filter((c) => c.rodada === id);
    sequencia.push({ rodada: id, antes: anterior, depois: agora, capa, trocas: daRodada.length, current: est.currentCoverId });
    confere(`rodada ${i + 1} (${id}): o hero mudou`, agora !== anterior, `antes ${anterior} · depois ${agora}`);
    confere(`rodada ${i + 1}: o HTML no ar é o id registrado no estado`, est.currentCoverId === agora, `estado ${est.currentCoverId} · HTML ${agora}`);
    confere(`rodada ${i + 1}: exatamente UMA troca na rodada`, daRodada.length === 1, `vieram ${daRodada.length}`);
    confere(`rodada ${i + 1}: o build reportou a troca no log`, /capa (rotacionada|do dia):/.test(capa), capa || "sem linha de capa");
    if (i === 0) {
      /* O caso que o relógio real pegou: no ramp-in ainda há matéria inédita no
         acervo DEPOIS de a rodada ter girado, e a trava da rodada tem de vir
         antes da inédita — senão todo rebuild troca e a meta vira contagem de
         build. Medido às 00:05 com dois builds na rodada 2026-11-06T20:23. */
      const { capa: repetida } = rodarBuild();
      confere(`rodada ${i + 1}: segundo build AINDA COM INÉDITA no acervo não troca o hero`, heroNoAr() === agora, `${heroNoAr()} vs ${agora}`);
      confere(`rodada ${i + 1}: o segundo build se declara mantido`, /capa mantida:/.test(repetida), repetida);
    }
    anterior = agora;
  }
  /* Segundo build DENTRO da mesma rodada: rebuild não é capa nova. */
  const { capa: segunda } = rodarBuild();
  const est = estadoNaDisco();
  const ultima = `${DIAS[HORAS.length - 1]}T${HORAS[HORAS.length - 1]}`;
  confere("segundo build na mesma rodada não troca o hero", heroNoAr() === anterior, `herói ${heroNoAr()} · esperado ${anterior}`);
  confere("segundo build na mesma rodada não registra segunda troca", est.changes.filter((c) => c.rodada === ultima).length === 1, `vieram ${est.changes.filter((c) => c.rodada === ultima).length}`);
  confere("segundo build na mesma rodada se declara mantida", /capa mantida:/.test(segunda), segunda);
}

/* nenhuma repetição em rodadas seguidas + ciclo completo */
{
  const ids = sequencia.map((s) => s.depois);
  let rep = null;
  for (let i = 1; i < ids.length; i++) if (ids[i] === ids[i - 1]) rep = ids[i];
  confere("nenhuma capa se repete em rodadas consecutivas", !rep, rep || "");
  const cobertas = new Set(ids);
  const elegiveis = require(path.join(ROOT, "tools", "lib", "cover-rules.js")).elegiveis(carregarDB(), pisoDaCapa());
  confere(`a rotação passou por TODAS as ${elegiveis.length} elegíveis em ${sequencia.length} rodadas`, cobertas.size === elegiveis.length, `foram ${cobertas.size}: ${[...cobertas].join(", ")}`);
}

/* ── C. matéria inédita toma a capa fora da ordem (publicação nova) ─────── */
{
  const est = estadoNaDisco();
  const elegiveis = require(path.join(ROOT, "tools", "lib", "cover-rules.js")).elegiveis(carregarDB(), pisoDaCapa());
  /* Faz de conta que a mais nova do acervo nunca passou pelo hero: é o estado
     imediatamente depois de um publish.js. Tirar só de `capaVistas` não simula
     nada — `loadState` reinclui no conjunto tudo que aparece no log `changes`, e
     com razão: quem já foi capa tem registro. A matéria nova não tem em nenhum
     dos dois. */
  const inedita = elegiveis[0].id;
  est.capaVistas = (est.capaVistas || []).filter((x) => x !== inedita);
  est.changes = (est.changes || []).filter((c) => c.id !== inedita);
  if (est.currentCoverId === inedita) est.currentCoverId = elegiveis[1].id;
  fs.writeFileSync(STATE, JSON.stringify(est, null, 2) + "\n");
  setRelogio("2026-12-02", "04:23");
  const antes = heroNoAr();
  const { capa } = rodarBuild();
  const depois = heroNoAr();
  confere("matéria que ainda não foi capa toma a capa na hora", depois === inedita && antes !== inedita, `antes ${antes} · depois ${depois} · esperado ${inedita}`);
  confere("o build chama isso de capa do dia, não de rotação", /capa do dia:/.test(capa), capa);
  const registro = estadoNaDisco().changes.slice(-1)[0];
  confere("a troca nova é registrada na rodada em curso", registro.rodada === "2026-12-02T04:23" && registro.id === inedita, JSON.stringify(registro));
}

/* ── D. acervo com 1 elegível: rodada NÃO pode se declarar servida ──────── */
{
  /* Sem para onde girar, registrarCapa não grava troca (repetir a capa não é
     troca) e a trava do turno.js tem de ver isso. Testa a função de estado, não
     o turno inteiro, porque o portão é exatamente trocaNaRodada. O estado é
     inventado em memória, mas registrarCapa grava no STATE_FILE de verdade — daí
     o backup ao redor. */
  setRelogio("2026-12-03", "00:23");
  const backup = fs.readFileSync(STATE);
  const cover = require(path.join(ROOT, "tools", "lib", "cover-state.js"));
  try {
    const state = { currentCoverId: "x", changes: [], capaVistas: ["x"] };
    const registrou = cover.registrarCapa(state, "x", "rotacionada", true);
    confere("registrar a mesma capa não conta como troca", registrou === false && state.changes.length === 0, JSON.stringify(state.changes));
    const mudou = cover.registrarCapa(state, "y", "rotacionada", true);
    confere("registrar outra matéria conta e carimba a era", mudou === true && state.changes[0].era === "x" && state.changes[0].rodada === "2026-12-03T00:23", JSON.stringify(state.changes));
    const heroIguais = cover.registrarCapa(state, "z", "rotacionada", false);
    confere("build que não escreveu nada no hero não serve a rodada", heroIguais === false && state.changes.length === 1, JSON.stringify(state.changes));
  } finally {
    fs.writeFileSync(STATE, backup);
  }
}

/* ── E. a troca da madrugada pertence à rodada de ontem ────────────────── */
{
  const cover = require(path.join(ROOT, "tools", "lib", "cover-state.js"));
  setRelogio("2026-12-05", "00:05");
  confere("00:05 está na rodada 20:23 de 04/12", cover.rodadaId() === "2026-12-04T20:23", cover.rodadaId());
  confere("e o dia da meta é 04/12, não 05/12", cover.diaDaMeta() === "2026-12-04", cover.diaDaMeta());
  const est = { changes: [{ at: "2026-12-05T03:05:00.000Z", id: "x" }] };
  confere("uma troca da madrugada conta no dia da rodada", cover.trocasNoDia(est, "2026-12-04") === 1 && cover.trocasNoDia(est, "2026-12-05") === 0, JSON.stringify(cover.loadState && est.changes));
}

/* ── restauração ────────────────────────────────────────────────────────── */
offset = 0;
global.Date = RealDate;
restaurar();
/* Conferir a própria restauração: um harness que devolve errado deixa o
   repositório com uma capa de mentira apontando para matéria que o estado não
   registra — e isso é invisível se ninguém comparar os bytes. */
const sobrou = [...instantaneos.entries()].filter(([f, bytes]) => !bytes.equals(fs.readFileSync(path.join(ROOT, f))));
confere(`a restauração devolveu byte a byte os ${instantaneos.size} arquivos do build`, sobrou.length === 0, sobrou.map(([f]) => f).join(", "));

console.log(`\nteste de capa por rodada — ${checks.filter((c) => c.ok).length}/${checks.length} verificações verdes (relógio falso, ${instantaneos.size} arquivos restaurados por instantâneo de bytes)`);
for (const c of checks.filter((x) => !x.ok)) console.log(`  ✗ ${c.descricao} ${c.detalhe}`);
if (!falhas.length) console.log("  ✓ hero por rodada: " + sequencia.map((s) => `${s.rodada.slice(11)}→${s.depois.slice(0, 28)}`).join("  "));
console.log(`\ndata real de volta: ${isoDe(agoraReal())}`);
process.exit(falhas.length || checks.some((c) => !c.ok) ? 1 : 0);
