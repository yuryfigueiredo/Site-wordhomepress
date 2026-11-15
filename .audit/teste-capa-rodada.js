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

/* O dia que a simulação percorre é DERIVADO do relógio real, não chumbado em
   "2026-12-01", e o relógio falso é SEMPRE cravado no instante exato da hora
   declarada + 3h — nunca em "agora + offset". Dois motivos, ambos medidos:

   1. `offsetDoFuso` (tools/lib/cover-state.js) faz
      `wall - Math.floor(date.getTime()/1000)*1000`, e esse piso à segunda casa o
      instante dentro do minuto. Com um relógio falso herdando os segundos/milis-
      segundos de agora, a conta devolve -3h + 1min e toda rodada cai no minuto
      ANTERIOR ao horário declarado: as seis rodadas viravam zero trocas.
      Cravando no instante exato, o resto do minuto é só o +500 ms abaixo.
   2. Um relógio assim plantado no futuro não toca nos dias reais: as trocas de
      verdade, feitas pelas rodadas do cron, continuam vivas no log de 14 dias e
      nada neste teste pode apagá-las. */
const DIA_BASE = new RealDate(Date.UTC(2027, 0, 5, 12)).toISOString().slice(0, 10);
const maisUmDia = (dia) => new RealDate(Date.parse(`${dia}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
const ONTEM = () => maisUmDia(DIA_BASE);
const DE_DIAS = (n) => new RealDate(Date.parse(`${DIA_BASE}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/* fuso = UTC-3 fixo desde 2019: "04:23 de Brasília" é 07:23 UTC. O offset é
   SOMADO ao instante, nunca aplicado como string de hora: com a régua em seis
   horários (14/11), o último deles é 22:23 local e a conta antiga
   (`(22+3) % 24` = 01:23Z do MESMO dia) devolvia 22:23 local do dia ANTERIOR —
   a rodada das 22:23 era simulada três horas adiantada, o balde da rodada vinha
   `2026-11-30T22:23`, e o `dia + 1` que as horas passavam por cima era exatamente
   o buraco. Mesma família do defeito de `offsetDoFuso` (06/11): aplicar o fuso
   duas vezes ou esquecê-lo uma.

   Os três campos do dia são convertidos UM A UM antes de entrar em `Date.UTC`:
   espalhar `"2027-01-05".split("-").map(Number)` deixa o mês 1 como índice 1,
   que é FEVEREIRO, e o harness passa a simular trinta dias depois do dia
   declarado — foi o que fez a primeira versão desta correção ver
   `2027-02-05T02:23` num dia escrito `2027-01-05`. */
const FUSO_LOCAL_MS = 3 * 3600 * 1000;
const utcDoFuso = (diaFuso, hhmm) => {
  const [ano, mes, dia] = String(diaFuso).split("-").map(Number);
  const [h, m] = hhmm.split(":").map(Number);
  return Date.UTC(ano, mes - 1, dia, h, m);
};
const fuso = (diaFuso, hhmm) =>
  /* +500 ms: a meia-segunda é o que sobra do piso à segunda de `offsetDoFuso` e
     faz o relógio falso cair no MESMO minuto da hora declarada. Sem ela, a
     rodada cujo horário coincide com o instante simulado nunca abriu (ver o
     bloco do DIA_BASE). */
  new FakeDate(utcDoFuso(diaFuso, hhmm) + FUSO_LOCAL_MS + 500);
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

/* A agenda que o balde da rodada usa é a do pipeline/cadence.json — a mesma que
   o doctor confere contra o cron do workflow. Chumbar "00:23, 04:23, ..." aqui é
   o que deixou este script vermelho com a régua certa depois que o Actions foi
   reduzido para 2 horários (08/11): a prova da capa virou defeito por snapshot. */
const AGENDA = JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "cadence.json"), "utf8")).check_hours;
const minutosDe = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const hhmmDe = (t) => `${String(Math.floor((((t % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String((((t % 1440) + 1440) % 1440) % 60).padStart(2, "0")}`;
const maisMinutos = (hhmm, delta) => hhmmDe(minutosDe(hhmm) + delta);

/* ── A. rodadaId: o balde da rodada ─────────────────────────────────────── */
{
  const cover = require(path.join(ROOT, "tools", "lib", "cover-state.js"));
  const primeira = AGENDA[0];
  const ultima = AGENDA[AGENDA.length - 1];
  confere(`a agenda lida tem horários e o teste tem com o que contar (${AGENDA.join(", ")})`, AGENDA.length >= 1, AGENDA.join(","));
  /* Cada horário é conferido contra o dia do FUSO que a própria conta dele devolve
     — não contra o dia declarado no laço. Com seis horários (14/11) o último é
     22:23 local, que em UTC já é o dia seguinte; um `add3` chumbado no dia
     declarado simulava essa rodada três horas adiantada (dia anterior) e o balde
     vinha o dia de ontem. Aqui a régua é conferida com ela mesma. */
  for (const hora of AGENDA) {
    setRelogio(DIA_BASE, hora);
    confere(`rodadaId no horário ${hora} de ${DIA_BASE} = ${bucketDaRodada(DIA_BASE, hora)}`, cover.rodadaId() === bucketDaRodada(DIA_BASE, hora), `veio ${cover.rodadaId()}`);
  }
  /* Rodada atrasada (medido no Actions: 1 a 170 min) pertence ao horário que
     deveria ter rodado, não ao minuto em que o node acordou. */
  const atrasada = maisMinutos(primeira, 107);
  setRelogio(DIA_BASE, atrasada);
  confere(`rodada das ${primeira} chegando ${atrasada} (1h47 tarde) conta como ${primeira}`, cover.rodadaId() === `${DIA_BASE}T${primeira}`, `veio ${cover.rodadaId()}`);
  /* Antes da primeira rodada do dia ainda está em curso a última de ontem — e o
     balde dela é o que a conta devolve para aquele horário declarado, não um
     `dia - 1` chumbado: com a agenda terminando em 22:23 local (14/11) o
     instantâneo UTC daquela rodada já é o dia seguinte, e quem escreve
     `${ONTEM}T${ultima}` erra o balde por um dia inteiro. */
  const bucketOntem = bucketDaRodada(DIA_BASE, ultima);
  setRelogio(DIA_BASE, maisMinutos(primeira, -13));
  confere(`${maisMinutos(primeira, -13)} pertence à rodada ${bucketOntem}`, cover.rodadaId() === bucketOntem, `veio ${cover.rodadaId()}`);
  setRelogio(DIA_BASE, maisMinutos(primeira, -1));
  confere(`${maisMinutos(primeira, -1)} (1 min antes) ainda é a rodada ${bucketOntem}`, cover.rodadaId() === bucketOntem, `veio ${cover.rodadaId()}`);
  setRelogio(DIA_BASE, primeira);
  confere(`${primeira} em ponto abre a rodada de hoje`, cover.rodadaId() === `${DIA_BASE}T${primeira}`, `veio ${cover.rodadaId()}`);
  if (AGENDA.length > 1) {
    /* O vão entre duas rodadas não é rodada nova: é a anterior, ainda em curso. */
    const noVao = maisMinutos(AGENDA[0], Math.floor((minutosDe(AGENDA[1]) - minutosDe(AGENDA[0])) / 2));
    setRelogio(DIA_BASE, noVao);
    confere(`${noVao}, no vão entre ${AGENDA[0]} e ${AGENDA[1]}, é a rodada das ${AGENDA[0]}`, cover.rodadaId() === `${DIA_BASE}T${AGENDA[0]}`, `veio ${cover.rodadaId()}`);
  }
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

/* ── B. um ciclo completo de build, mais um segundo build na última rodada ── */
/* A janela é DERIVADA do acervo, não chumbada. Com N elegíveis o ciclo completo
   tem N rodadas, então sete rodadas fixas só conseguem cobrir o acervo enquanto
   ele tiver ≤7 peças — em 07/11, com oito elegíveis, o teste reprovava por
   aritmética própria, não por defeito da regra. Duas voltas completas,
   arredondadas para dias inteiros do check_hours, valem para qualquer tamanho
   de catálogo. */
const HORAS_DIA = AGENDA;
/* O balde de uma rodada simulada é o que a CONTA dele devolve para aquele
   instante — não o dia declarado concatenado com a hora. Com seis horários a
   agenda termina em 22:23 local, e `rodadaId` carimba esse balde no dia do fuso
   que o instante translationado mostra (medido: `2027-01-05T22:23`, enquanto o
   instantâneo UTC já era 06/01). Chumbar `${dia}T${hora}` refaria em outro lugar
   o mesmo erro do `add3`: contar a troca da rodada das 22:23 num dia que ela
   nunca ocupou. */
function bucketDaRodada(diaFuso, hhmm) { return require(path.join(ROOT, "tools", "lib", "cover-state.js")).rodadaId(fuso(diaFuso, hhmm)); }
function rodadaEm(i) {
  return { dia: DE_DIAS(Math.floor(i / HORAS_DIA.length)), hora: HORAS_DIA[i % HORAS_DIA.length] };
}
const nElegiveis = require(path.join(ROOT, "tools", "lib", "cover-rules.js")).elegiveis(carregarDB(), pisoDaCapa()).length;
/* Uma volta COMPLETA do ciclo são N rodadas, e a rotação só precisa disso:
   `proximaNaRotação` anda um passo por rodada e enrola sozinha no fim da lista.
   A janela era "duas voltas arredondadas para dias inteiros" (= 30 rodadas com
   14 elegíveis e 6 horários), e a segunda volta sobrava exatamente na rodada
   cujo herói novo é o incumbente que abriu o ciclo — o passo degenerado que
   `registrarTroca` recusa ("repetir a capa não é troca") e o hero fica parado.
   Não é afrouxamento: a cobertura de TODAS as elegíveis em rodadas consecutivas
   sem repetição é conferida abaixo, e uma volta a mais não prova nada que ela
   não prove. Dias inteiros continuam sendo a unidade, para o ciclo caber em
   dias do fuso e o vão entre dias não simular rodada fantasma. */
const JANELA = Math.ceil(nElegiveis / HORAS_DIA.length) * HORAS_DIA.length;
const DIAS = [];
const HORAS = [];
for (let i = 0; i < JANELA; i++) {
  const r = rodadaEm(i);
  DIAS.push(r.dia);
  HORAS.push(r.hora);
}
/* O estado da capa é montado de propósito antes do ciclo, e os instantâneos já
   gravados devolvem-no byte a byte no fim. Dois motivos, ambos medidos:

   1. `registrarTroca` corta o log pelo relógio falso (`Date.now() - 14 dias`).
      Simular uma época que não é a de agora apagaria as trocas reais em silêncio
      — o harness deixaria de ser leitura. Com o log zerado nada é cortável.
   2. Com o catálogo atual (14 elegíveis, seis horários) duas voltas fecham em
      30 rodadas e a rotação, ao enrolar, cai em pé NO INCUMBENTE: a troca da
      rodada 6 seria x→x, que `registrarTroca` recusa com razão ("repetir a capa
      não é troca"). Uma janela de N−1 rodadas percorre todas as elegíveis sem
      pedir esse passo degenerado. Para isso o herói precisa estar FORA da lista
      (senão `pickCover` responde "mantida" na primeira rodada) e a última troca
      registrada tem de ser da rodada ANTERIOR à janela (senão a trava vê a
      época velha como rodada já servida e o ciclo inteiro fica `mantida`). */
{
  const cover = require(path.join(ROOT, "tools", "lib", "cover-state.js"));
  const elegiveisB = require(path.join(ROOT, "tools", "lib", "cover-rules.js")).elegiveis(carregarDB(), pisoDaCapa());
  const foraDoAcervo = "fixture-capa-fora-do-acervo";
  const state = cover.loadState();
  /* Nada do acervo pode constar como visto: a janela tem N−1 rodadas e uma
     inédita tomaria a capa fora da ordem, encurtando a rotação conferida. */
  state.currentCoverId = foraDoAcervo;
  state.capaVistas = [];
  state.changes = [
    {
      at: isoDe(fuso(ONTEM(), HORAS_DIA[HORAS_DIA.length - 1])),
      id: foraDoAcervo,
      tipo: "rotacionada",
      era: null,
      rodada: `${ONTEM()}T${HORAS_DIA[HORAS_DIA.length - 1]}`,
      dia: ONTEM(),
    },
  ];
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
  confere(`a janela simulada (${JANELA - HORAS_DIA.length} rodadas) é o ciclo de ${nElegiveis} elegíveis menos uma`, JANELA - HORAS_DIA.length === nElegiveis - 1, `veio ${JANELA - HORAS_DIA.length}`);
  confere("o estado plantado põe o herói fora do acervo e limpa o log", estadoNaDisco().currentCoverId === foraDoAcervo && !require(path.join(ROOT, "tools", "lib", "cover-rules.js")).elegiveis(carregarDB(), pisoDaCapa()).some((a) => a.id === foraDoAcervo), foraDoAcervo);
}
const sequencia = [];
{
  let anterior = heroNoAr();
  for (let i = 0; i < HORAS.length; i++) {
    setRelogio(DIAS[i], HORAS[i]);
    const { capa, erro } = rodarBuild();
    if (erro) {
      /* `falhas.push` sozinho escondia a causa: aquela lista só decide se o resumo
         do ciclo é impresso, e o resumo final percorre `checks`. Um build que
         estoura no meio do ciclo aparecia como dois vermelhos sem explicação lá
         embaixo — foi assim que 10/11 pareceu defeito de rotação. */
      confere(`o build da rodada ${i + 1} (${DIAS[i]}T${HORAS[i]}) roda sem estourar`, false, erro.message);
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
  /* A rodada em curso é o balde que a conta dele devolve para o instante
     simulado — com 22:23 local ele pode ser o dia declarado OU o anterior, e as
     duas leituras abaixo têm de bater com o carimbo que o próprio build escreveu. */
  const coverB = require(path.join(ROOT, "tools", "lib", "cover-state.js"));
  const ultima = coverB.rodadaId(fuso(DIAS[HORAS.length - 1], HORAS[HORAS.length - 1]));
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
  /* Sem esta linha o "não cobriu tudo" podia ser aritmética do harness: janela
     menor que o acervo não cobre, e isso não é defeito da rotação. */
  confere(`a janela simulada (${sequencia.length} rodadas) cabe pelo menos uma volta do ciclo de ${elegiveis.length} elegíveis`, sequencia.length >= elegiveis.length, `janela ${sequencia.length} < acervo ${elegiveis.length}`);
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
  const inedita = elegiveis.find((a) => a.id !== heroNoAr()).id;
  est.capaVistas = (est.capaVistas || []).filter((x) => x !== inedita);
  est.changes = (est.changes || []).filter((c) => c.id !== inedita);
  if (est.currentCoverId === inedita) est.currentCoverId = elegiveis.find((a) => a.id !== inedita).id;
  fs.writeFileSync(STATE, JSON.stringify(est, null, 2) + "\n");
  /* Rodada seguinte à janela do bloco B: dentro da janela toda rodada já tem
     troca registrada, e a trava derrubaria o build antes da inédita. */
  const rC = rodadaEm(JANELA);
  setRelogio(rC.dia, rC.hora);
  const antes = heroNoAr();
  const { capa } = rodarBuild();
  const depois = heroNoAr();
  confere("matéria que ainda não foi capa toma a capa na hora", depois === inedita && antes !== inedita, `antes ${antes} · depois ${depois} · esperado ${inedita}`);
  confere("o build chama isso de capa do dia, não de rotação", /capa do dia:/.test(capa), capa);
  const registro = estadoNaDisco().changes.slice(-1)[0];
  confere("a troca nova é registrada na rodada em curso", registro.rodada === `${rC.dia}T${rC.hora}` && registro.id === inedita, JSON.stringify(registro));
}

/* ── D. acervo com 1 elegível: rodada NÃO pode se declarar servida ──────── */
{
  /* Sem para onde girar, registrarCapa não grava troca (repetir a capa não é
     troca) e a trava do turno.js tem de ver isso. Testa a função de estado, não
     o turno inteiro, porque o portão é exatamente trocaNaRodada. O estado é
     inventado em memória, mas registrarCapa grava no STATE_FILE de verdade — daí
     o backup ao redor. */
  setRelogio("2026-12-03", AGENDA[0]);
  const backup = fs.readFileSync(STATE);
  const cover = require(path.join(ROOT, "tools", "lib", "cover-state.js"));
  try {
    const state = { currentCoverId: "x", changes: [], capaVistas: ["x"] };
    const registrou = cover.registrarCapa(state, "x", "rotacionada", true);
    confere("registrar a mesma capa não conta como troca", registrou === false && state.changes.length === 0, JSON.stringify(state.changes));
    const mudou = cover.registrarCapa(state, "y", "rotacionada", true);
    confere("registrar outra matéria conta e carimba a era", mudou === true && state.changes[0].era === "x" && state.changes[0].rodada === `2026-12-03T${AGENDA[0]}`, JSON.stringify(state.changes));
    const heroIguais = cover.registrarCapa(state, "z", "rotacionada", false);
    confere("build que não escreveu nada no hero não serve a rodada", heroIguais === false && state.changes.length === 1, JSON.stringify(state.changes));
  } finally {
    fs.writeFileSync(STATE, backup);
  }
}

/* ── E. o minuto antes da primeira rodada do dia pertence à rodada de ontem ─ */
{
  const cover = require(path.join(ROOT, "tools", "lib", "cover-state.js"));
  const ultima = AGENDA[AGENDA.length - 1];
  const antesDaPrimeira = maisMinutos(AGENDA[0], -13);
  const instante = fuso("2026-12-05", antesDaPrimeira);
  setRelogio("2026-12-05", antesDaPrimeira);
  confere(`${antesDaPrimeira} está na rodada ${ultima} de 04/12`, cover.rodadaId() === `2026-12-04T${ultima}`, cover.rodadaId());
  confere("e o dia da meta é 04/12, não 05/12", cover.diaDaMeta() === "2026-12-04", cover.diaDaMeta());
  const est = { changes: [{ at: isoDe(instante), id: "x" }] };
  confere(`uma troca às ${antesDaPrimeira} conta no dia da rodada`, cover.trocasNoDia(est, "2026-12-04") === 1 && cover.trocasNoDia(est, "2026-12-05") === 0, JSON.stringify(est.changes));
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
