/* cover-state.js — gerencia o estado da capa para forçar trocas quando
   nenhuma matéria foi publicada no período.

   Janelas (horário de Brasília):
   - dia: 03:00 às 12:59
   - noite: 13:00 às 02:59

   Se nenhuma matéria foi publicada na janela atual, a capa é trocada
   forçadamente (escolhe a próxima matéria elegível, não a mais recente). */

const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "..", "..", "pipeline", "state", "cover-state.json");

function currentWindow() {
  const now = new Date();
  const brasilia = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const hour = brasilia.getHours();
  return hour >= 3 && hour < 13 ? "day" : "night";
}

/* Retorna o início da janela atual em UTC (ISO string) */
function windowStart() {
  const now = new Date();
  const brasilia = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const hour = brasilia.getHours();
  const isDay = hour >= 3 && hour < 13;
  const startHour = isDay ? 3 : 13;

  // Cria a data do início da janela em Brasília
  const start = new Date(brasilia);
  start.setHours(startHour, 0, 0, 0);

  // Se o início calculado é no futuro (ex.: agora é 02:00 e calculamos 13:00 de hoje),
  // volta para o início do dia anterior
  if (start > brasilia) {
    start.setDate(start.getDate() - 1);
  }

  // Converte de volta para UTC
  const utcString = start.toLocaleString("en-US", { timeZone: "UTC" });
  return new Date(utcString).toISOString();
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { lastPublishPerWindow: {}, currentCoverId: null, lastForcedChange: null };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

function shouldForceChange(state, window) {
  const lastPublish = state.lastPublishPerWindow[window];
  const lastForced = state.lastForcedPerWindow?.[window];

  // Se nunca publicou e nunca forçou nesta janela, força
  if (!lastPublish && !lastForced) return true;

  const windowStartISO = windowStart();
  const publishAfterWindowStart = lastPublish && new Date(lastPublish).toISOString() >= windowStartISO;
  const forcedAfterWindowStart = lastForced && new Date(lastForced).toISOString() >= windowStartISO;

  // Se já publicou ou forçou nesta janela, não força de novo
  return !publishAfterWindowStart && !forcedAfterWindowStart;
}

function recordPublish(state, articleId) {
  const window = currentWindow();
  state.lastPublishPerWindow[window] = new Date().toISOString();
  state.currentCoverId = articleId;
  saveState(state);
}

function recordForcedChange(state, articleId) {
  const window = currentWindow();
  if (!state.lastForcedPerWindow) state.lastForcedPerWindow = {};
  state.lastForcedPerWindow[window] = new Date().toISOString();
  state.currentCoverId = articleId;
  saveState(state);
}

module.exports = { currentWindow, windowStart, loadState, saveState, shouldForceChange, recordPublish, recordForcedChange };
