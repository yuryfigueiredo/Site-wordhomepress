/* cover-state.js — memória da capa: quem está no ar e quando a capa trocou.

   Janelas (horário de Brasília, fixo em UTC-3 desde 2019):
   - dia: 03:00 às 12:59
   - noite: 13:00 às 02:59

   A meta é `cover_changes_per_day` (2): uma troca por janela. A régua é o log
   `changes` — "capa trocou" é o que o leitor vê. Se a janela atual ainda não
   teve troca, o build.js troca a capa forçadamente, pela próxima matéria
   elegível, não pela mais recente. Publicar ou não publicar não entra aqui:
   publicar não é capa (a nota pode ficar abaixo do piso) e o Actions faz vários
   rebuilds por rodada. Cada entrada do histórico carrega a janela a que
   pertence (`janela`), porque a janela da noite atravessa a meia-noite: sem
   isso, uma troca às 01h contava para o dia seguinte e o painel mostrava 3/2
   num dia que cumpriu a meta.

   O estado mora em pipeline/state/cover-state.json e PRECISA estar versionado:
   com o arquivo ignorado pelo git, cada rodada do Actions acordava sem memória,
   `currentCoverId` era null, a troca "forçada" escolhia a matéria mais nova
   anyway e a meta de 2 trocas por dia nunca era cumprida lá. O log `changes` é o
   que responde "quantas capas trocaram hoje" sem arqueologia de git.           */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const STATE_FILE = path.join(ROOT, "pipeline", "state", "cover-state.json");
const FUSO = "America/Sao_Paulo";
const HORA_DIA = 3; // abre a janela "dia"
const HORA_NOITE = 13; // abre a janela "noite"
const HORA = 3600000;
const DIA = 86400000;

/* Deslocamento do fuso em ms, calculado pelo Intl (nada de parsear string de
   data): wall clock = instantâneo + off. Em 2026-11-06 a conta antiga
   (toLocaleString → new Date → toLocaleString) aplicava o offset duas vezes e
   windowStart() devolvia 19:00 UTC em vez de 16:00 UTC — três horas de janela
   invisível, durante as quais a capa era trocada "por engano" a cada rodada. */
function offsetDoFuso(date, tz = FUSO) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(date)
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  const wall = Date.UTC(
    Number(partes.year),
    Number(partes.month) - 1,
    Number(partes.day),
    Number(partes.hour) % 24,
    Number(partes.minute),
    Number(partes.second),
  );
  return wall - Math.floor(date.getTime() / 1000) * 1000;
}

/* "AAAA-MM-DD" e hora no fuso declarado — sem Date local do sistema no meio. */
function noFuso(date, tz = FUSO) {
  const off = offsetDoFuso(date, tz);
  const wall = date.getTime() + off;
  const d = new Date(wall);
  return {
    dia: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
    hora: d.getUTCHours(),
    wall,
    off,
  };
}

/* Identidade da janela que está no ar: "AAAA-MM-DD/day" ou ".../night", onde a
   data é o dia do fuso em que a janela ABRIU. A janela night atravessa a
   meia-noite (13:00 às 02:59), então uma troca às 01h pertence à noite do dia
   anterior. Contar pela data do instante (como fazia esta régua até 2026-11-07)
   dava 3 trocas num dia do fuso e 1 no seguinte, contra uma meta de 2: o painel
   mentia sobre a meta sem que nada estivesse errado no site. */
function janelaId(date = new Date()) {
  const inicio = new Date(windowStart(date));
  return `${noFuso(inicio).dia}/${currentWindow(inicio)}`;
}

/* Janela a que pertence uma entrada do histórico. Entradas antigas (pré-2026
   -11-07) não têm o campo: deriva-se do instante, para a régua não contar dois
   sistemas diferentes no mesmo arquivo. */
function janelaDaEntrada(c) {
  if (c.janela) return c.janela;
  const t = Date.parse(c.at);
  return Number.isNaN(t) ? null : janelaId(new Date(t));
}

function currentWindow(date = new Date()) {
  const h = noFuso(date).hora;
  return h >= HORA_DIA && h < HORA_NOITE ? "day" : "night";
}

/* Início da janela atual como instante UTC real (ISO). Se a janela abriu no
   dia de ontem do fuso (noite às 13h quando agora é 01h), volta 24h. */
function windowStart(date = new Date()) {
  const { wall, off, hora } = noFuso(date);
  const startHour = hora >= HORA_DIA && hora < HORA_NOITE ? HORA_DIA : HORA_NOITE;
  const meiaNoiteWall = Math.floor(wall / DIA) * DIA;
  let start = meiaNoiteWall + startHour * HORA;
  if (start > wall) start -= DIA;
  return new Date(start - off).toISOString();
}

function loadState() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    state.changes = Array.isArray(state.changes) ? state.changes : [];
    /* Schemas antigos (2026-11-06/07) guardavam "última publicação da janela" e
       "última troca forçada da janela" em dois dicionários. Eram duas réguas
       mortas: `lastPublishPerWindow` era carimbada por QUALQUER build (o
       `if (!forceChange) recordPublish` do build.js não sabia se havia saída de
       matéria nova), então a janela se declarava "servida" sem a capa ter
       mudado — e o publish.js também a escrevia, mesmo quando a matéria
       publicada não virou capa. A régua agora é uma só: o log `changes`. */
    delete state.lastForcedChange;
    delete state.lastPublishPerWindow;
    delete state.lastForcedPerWindow;
    /* Entradas anteriores a 2026-11-07 não têm `janela` nem `era`. Normaliza-se
       na leitura para o build e o doctor verem um sistema só — e para a trava
       "a mais nova é a que a rotação derrubou" não ficar cega. `era` deriva do
       registro anterior porque o log só é escrito por registrarCapa, que acaba
       de definir a capa: a troca seguinte derruba exatamente quem estava no ar.
       Sem predecessor, era fica null e a trava não se aplica. */
    let anterior = null;
    for (const c of state.changes) {
      if (!c.janela) c.janela = janelaDaEntrada(c);
      if (c.era === undefined) c.era = anterior ? anterior.id : null;
      anterior = c;
    }
    return state;
  } catch {
    return { currentCoverId: null, changes: [] };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

/* Registra a capa que acabou de ir ao ar, com o id de quem ela tirou o lugar
   (`era`). Repetir a capa da janela não conta como troca: o Actions roda
   build.js várias vezes por rodada. A trava é pela JANELA, não pelo registro
   anterior, porque a rotação forçada A→B seguida de um build que devolvesse a
   capa para A criaria uma segunda troca sem nada ter sido publicado — e A só
   tinha registro na janela anterior, então o "não repita o id do último" não
   pegava. */
function registrarTroca(state, articleId, tipo, era = null) {
  const agora = new Date();
  const id = janelaId(agora);
  const daJanela = (state.changes || []).filter((c) => janelaDaEntrada(c) === id);
  if (daJanela.some((c) => c.id === articleId)) return;
  state.changes.push({ at: agora.toISOString(), dia: noFuso(agora).dia, janela: id, id: articleId, tipo, era });
  const corte = Date.now() - 14 * DIA;
  state.changes = state.changes.filter((c) => Date.parse(c.at) >= corte);
}

/* A janela está servida quando a capa TROCOU dentro dela. Nada além disso:
   "publicou na janela" não serve de régua, porque publicar não é capa (a nota
   pode estar abaixo do piso) e "o build rodou na janela" não serve, porque o
   rebuild do Actions roda várias vezes por rodada sem trocar nada. */
function trocaNaJanela(state, date) {
  const id = janelaId(date);
  return (state.changes || []).some((c) => janelaDaEntrada(c) === id);
}

function trocasNaJanela(state, date = new Date()) {
  const id = janelaId(date);
  return (state.changes || []).filter((c) => janelaDaEntrada(c) === id).length;
}

/* Última troca da janela atual, ou null. build.js precisa dela para saber a
   partir de QUE INSTANTE uma publicação nova toma a capa: sem isso, o build
   seguinte ao da troca forçada voltava para "a matéria mais nova" — desfazia a
   rotação e ainda registrava segunda troca sem nada ter sido publicado. */
function ultimaTrocaNaJanela(state, date = new Date()) {
  const id = janelaId(date);
  const daJanela = (state.changes || []).filter((c) => janelaDaEntrada(c) === id);
  return daJanela.length ? daJanela[daJanela.length - 1] : null;
}

function shouldForceChange(state) {
  return !trocaNaJanela(state);
}

/* Quem escreve o estado é só o build.js, com o id que efetivamente foi ao ar no
   slot index-hero. tipo = "forcada" (a janela não tinha troca e o build pulou
   para a próxima elegível) ou "do dia" (a matéria mais nova do catálogo tomou a
   capa — em geral porque acabou de ser publicada). `era` é a capa que perdeu o
   lugar: sem ela, o build seguinte não sabe se a matéria mais nova é uma
   publicação nova ou apenas a capa que a rotação tinha acabado de derrubar. */
function registrarCapa(state, articleId, tipo, mudouHero = true) {
  const era = state.currentCoverId;
  state.currentCoverId = articleId;
  /* Troca é o que o leitor vê. Repetir a mesma capa — o caso de uma matéria
     elegível sozinha no catálogo, em que a "rotação forçada" não tem para onde
     girar — não serve janela nenhuma, por mais que o build tenha rodado. */
  if (mudouHero && era !== articleId) registrarTroca(state, articleId, tipo, era);
  saveState(state);
}

/* Quantas janelas do dia já tiveram troca — É A RÉGUA DA META
   `cover_changes_per_day`, e o dia tem 2 janelas, então ela vai de 0 a 2.
   Contar entradas do histórico daria 3 num dia e 1 no seguinte, porque a troca
   da madrugada pertence à noite do dia anterior: o painel diria "3/2" ou
   "1/2" para um site que cumpriu a meta exatamente. */
function janelasServidasNoDia(state, dia) {
  const alvo = dia || diaDaJanelaAtual();
  const ids = new Set();
  for (const c of state.changes || []) {
    const id = janelaDaEntrada(c);
    if (id && id.startsWith(`${alvo}/`)) ids.add(id);
  }
  return ids.size;
}

/* Quantas capas efetivamente foram ao ar nas janelas daquele dia. Pode passar
   do número de janelas: publicar no meio de uma janela que já tinha troca é uma
   capa a mais, não uma meta a mais. */
function trocasNoDia(state, dia) {
  const alvo = dia || diaDaJanelaAtual();
  return (state.changes || []).filter((c) => {
    const id = janelaDaEntrada(c);
    return id ? id.startsWith(`${alvo}/`) : false;
  }).length;
}

/* O dia que a meta de capa está cobrando agora. NÃO é o dia do relógio: a
   janela da noite (13:00–02:59) atravessa a meia-noite, então às 00:23 de
   Brasília o relógio já virou e o que ainda está em curso é o dia de ontem.
   Ancorar no relógio fazia toda rodada da madrugada (a de 00:23 é uma das seis
   do cron) mostrar 0/2 e o painel reclamar de um dia cujas janelas nem abriram. */
function diaDaJanelaAtual(date = new Date()) {
  return janelaId(date).split("/")[0];
}

module.exports = {
  FUSO,
  STATE_FILE,
  currentWindow,
  windowStart,
  janelaId,
  loadState,
  saveState,
  trocaNaJanela,
  trocasNaJanela,
  ultimaTrocaNaJanela,
  shouldForceChange,
  registrarCapa,
  trocasNoDia,
  janelasServidasNoDia,
  diaDaJanelaAtual,
};
