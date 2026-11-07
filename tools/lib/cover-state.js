/* cover-state.js — gerencia o estado da capa para forçar trocas quando
   nenhuma matéria foi publicada no período.

   Janelas (horário de Brasília, fixo em UTC-3 desde 2019):
   - dia: 03:00 às 12:59
   - noite: 13:00 às 02:59

   Se nenhuma matéria foi publicada na janela atual, a capa é trocada
   forçadamente (escolhe a próxima matéria elegível, não a mais recente).

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
    state.lastPublishPerWindow = state.lastPublishPerWindow || {};
    state.lastForcedPerWindow = state.lastForcedPerWindow || {};
    state.changes = Array.isArray(state.changes) ? state.changes : [];
    /* Schema antigo (2026-11-06) tinha lastForcedChange solto: era uma segunda
       régua de "última troca", lida só pelo force-daily-target.js que não
       existe mais. Some do arquivo para não parecer estado vivo. */
    delete state.lastForcedChange;
    return state;
  } catch {
    return { lastPublishPerWindow: {}, lastForcedPerWindow: {}, currentCoverId: null, changes: [] };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

/* Registra a capa que acabou de ir ao ar. Repetir o mesmo id não conta como
   troca: sem isso, cada build (e o Actions faz vários por rodada) inflaria o
   histórico e a meta de 2 trocas por dia seria "cumprida" por rebuild. */
function registrarTroca(state, articleId, tipo) {
  const agora = new Date();
  const ultimo = state.changes[state.changes.length - 1];
  if (ultimo && ultimo.id === articleId) return;
  state.changes.push({ at: agora.toISOString(), dia: noFuso(agora).dia, id: articleId, tipo });
  const corte = Date.now() - 14 * DIA;
  state.changes = state.changes.filter((c) => Date.parse(c.at) >= corte);
}

function shouldForceChange(state, window) {
  const lastPublish = state.lastPublishPerWindow[window];
  const lastForced = state.lastForcedPerWindow[window];
  if (!lastPublish && !lastForced) return true;
  const inicio = windowStart();
  const depois = (t) => t && Date.parse(t) >= Date.parse(inicio);
  return !depois(lastPublish) && !depois(lastForced);
}

function recordPublish(state, articleId) {
  const window = currentWindow();
  state.lastPublishPerWindow[window] = new Date().toISOString();
  state.currentCoverId = articleId;
  registrarTroca(state, articleId, "publicacao");
  saveState(state);
}

function recordForcedChange(state, articleId) {
  const window = currentWindow();
  state.lastForcedPerWindow[window] = new Date().toISOString();
  state.currentCoverId = articleId;
  registrarTroca(state, articleId, "forcada");
  saveState(state);
}

/* Quantas capas trocaram no dia do fuso declarado (o dia que o leitor vê). */
function trocasNoDia(state, dia) {
  const alvo = dia || noFuso(new Date()).dia;
  return state.changes.filter((c) => c.dia === alvo).length;
}

/* Data de hoje no fuso do site — para as réguas não virarem a meia-noite de
   Brasília duas horas depois do que o dono espera. */
function hojeNoFuso() {
  return noFuso(new Date()).dia;
}

module.exports = {
  FUSO,
  STATE_FILE,
  currentWindow,
  windowStart,
  loadState,
  saveState,
  shouldForceChange,
  recordPublish,
  recordForcedChange,
  trocasNoDia,
  hojeNoFuso,
};
