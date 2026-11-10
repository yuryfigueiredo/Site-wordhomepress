/* cover-state.js — memória da capa: quem está no ar e quando a capa trocou.

   A régua é a RODADA: `pipeline/cadence.json → check_hours` são os horários em
   que o GitHub dispara o turno (o doctor.js confere se eles batem com o cron do
   workflow). Cada rodada que abre sem troca registrada gira a capa; rodada que
   já girou não gira de novo, por mais que o build.js rode três vezes dentro
   dela — o Actions chama build pelo publish.js e de novo pelo girarCapa().

   Por que a janela (dia 03:00-12:59 / noite 13:00-02:59) deixou de ser a
   unidade em 2026-11-07: com seis rodadas por dia, cada janela conteria três
   rodadas e a meta cobraria duas. A capa é o que mais chama atenção, então a
   regra passou a ser girar em TODA rodada, com matéria nova ou não. Isso também
   conserta a contagem do dia: no esquema de janelas a rodada de 00:23 pertencia
   à noite do dia anterior, e o painel mostraria 5/6 num dia que cumpriu as seis.
   Agora cada troca carimba o dia do fuso em que ela aconteceu.

   Girar é andar na lista de elegíveis, não voltar sempre para a mesma: com uma
   troca a cada 4 horas, o "próxima diferente da atual" do esquema antigo faria
   ping-pong A→B→A→B, o leitor veria duas matérias repetidas à exaustão e o resto
   do acervo nunca abriria. `proximaNaRotação` caminha pela lista.

   O estado mora em pipeline/state/cover-state.json e PRECISA estar versionado:
   com o arquivo ignorado pelo git, cada rodada do Actions acordava sem memória,
   `currentCoverId` era null, a troca "forçada" escolhia a matéria mais nova
   anyway e a meta nunca era cumprida lá. O log `changes` é o que responde
   "quantas capas trocaram hoje" sem arqueologia de git.                        */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const STATE_FILE = path.join(ROOT, "pipeline", "state", "cover-state.json");
const CADENCE_FILE = path.join(ROOT, "pipeline", "cadence.json");
const FUSO = "America/Sao_Paulo";
const DIA = 86400000;
/* Quantos ids de "já foi capa" o estado carrega. Não é o log (esse é cortado em
   14 dias): é a memória de longo prazo que diz se uma matéria ainda é NOVIDADE a
   ponto de tomar a capa fora da ordem ou se já entrou e saiu do hero e por isso
   só volta pela rotação. 400 cobre meses de publicação.                         */
const MAX_CAPAS_VISTAS = 400;

/* Deslocamento do fuso em ms, calculado pelo Intl (nada de parsear string de
   data): wall clock = instantâneo + off. Em 2026-11-06 a conta antiga
   (toLocaleString → new Date → toLocaleString) aplicava o offset duas vezes e
   o início da janela voltava três horas adiantado — a capa era trocada "por
   engano" a cada rodada dentro dessas três horas. */
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

/* "AAAA-MM-DD", hora, minuto e o instantâneo transladado para o relógio do fuso
   — sem Date local do sistema no meio. */
function noFuso(date, tz = FUSO) {
  const off = offsetDoFuso(date, tz);
  const wall = date.getTime() + off;
  const d = new Date(wall);
  return {
    dia: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
    hora: d.getUTCHours(),
    minuto: d.getUTCMinutes(),
    wall,
    off,
  };
}

function cadencia() {
  try {
    return JSON.parse(fs.readFileSync(CADENCE_FILE, "utf8"));
  } catch {
    return {};
  }
}

/* Minutos desde a meia-noite do fuso em que cada rodada abre. A agenda é a
   mesma que o doctor.js já confere contra o cron do workflow (`check_hours`),
   então capa e publicação são contadas no mesmo relógio, por uma régua só. */
function horariosDasRodadas() {
  const cad = cadencia();
  const horas = (cad.check_hours || [])
    .map((h) => /^(\d{1,2}):(\d{2})$/.exec(String(h)))
    .filter(Boolean)
    .map((m) => Number(m[1]) * 60 + Number(m[2]));
  return [...new Set(horas)].sort((a, b) => a - b);
}

/* Quantas rodadas o dia tem — é o valor que `cover_changes_per_day` tem de ter. */
function rodadasDoDia() {
  return horariosDasRodadas().length;
}

const fmtMinuto = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/* Identidade da rodada em curso: "AAAA-MM-DDTHH:MM", com a data do dia do fuso
   em que aquela rodada abriu. Uma rodada atrasada (medido em 34 rodadas: o cron
   do GitHub chega de 1 a 170 minutos tarde) pertence ao horário que ela deveria
   ter rodado, não ao minuto em que o node acordou — senão o turno das 04:23 que
   só dispara às 06:10 contaria como rodada extra e giraria duas vezes no mesmo
   intervalo de agenda.

   Sem `check_hours` legível, cai para um balde por hora: a rotação continua no
   máximo uma por rodada (as rodadas estão a horas de distância) e a régua não
   passa a depender de agenda inventada que o doctor não confere. */
function rodadaId(date = new Date()) {
  const { dia, hora, minuto, wall } = noFuso(date);
  const agora = hora * 60 + minuto;
  const horarios = horariosDasRodadas();
  if (!horarios.length) return `${dia}T${String(hora).padStart(2, "0")}:00`;

  const abriu = [...horarios].reverse().find((m) => m <= agora);
  const alvo = abriu !== undefined ? abriu : horarios[horarios.length - 1];
  if (abriu !== undefined) return `${dia}T${fmtMinuto(alvo)}`;

  /* Antes da primeira rodada do dia ainda está em curso a última de ontem. */
  return `${new Date(wall - DIA).toISOString().slice(0, 10)}T${fmtMinuto(alvo)}`;
}

/* Rodada a que pertence uma entrada do histórico. Entradas antigas não têm o
   campo (carregavam `janela`): deriva-se do instante, para a régua não contar
   dois sistemas diferentes no mesmo arquivo. */
function rodadaDaEntrada(c) {
  if (c.rodada) return c.rodada;
  const t = Date.parse(c.at);
  return Number.isNaN(t) ? null : rodadaId(new Date(t));
}

function loadState() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    state.changes = Array.isArray(state.changes) ? state.changes : [];
    /* Schemas antigos (2026-11-06/07) guardavam "última publicação da janela" e
       "última troca forçada da janela" em dois dicionários. Eram duas réguas
       mortas: `lastPublishPerWindow` era carimbada por QUALQUER build, então a
       janela se declarava "servida" sem a capa ter mudado — e o publish.js também
       a escrevia, mesmo quando a matéria publicada não virou capa. A régua agora
       é uma só: o log `changes`, medido pela rodada. */
    delete state.lastForcedChange;
    delete state.lastPublishPerWindow;
    delete state.lastForcedPerWindow;
    delete state.janela;
    /* Trocas pré-2026-11-07 não têm `rodada` nem `era`. Normaliza-se na leitura
       para build e doctor verem um sistema só. `era` deriva do registro anterior
       porque o log só é escrito por registrarCapa, que acabou de definir a capa:
       a troca seguinte derruba exatamente quem estava no ar. */
    let anterior = null;
    for (const c of state.changes) {
      delete c.janela;
      if (!c.rodada) c.rodada = rodadaDaEntrada(c);
      /* `dia` é sempre o dia da rodada, reescrito na leitura: as primeiras
         entradas da regra nova carimbaram o dia do INSTÂNTANEO, e uma troca às
         00:05 da rodada das 20:23 de ontem ficaria em dois dias diferentes
         dependendo de quem conta. */
      if (c.rodada) c.dia = String(c.rodada).slice(0, 10);
      if (c.era === undefined) c.era = anterior ? anterior.id : null;
      anterior = c;
    }
    /* `capaVistas` nasce do que o log já registra: nenhuma matéria é tratada como
       inédita só porque o campo ainda não existia no arquivo. */
    const vistas = new Set(Array.isArray(state.capaVistas) ? state.capaVistas : []);
    for (const c of state.changes) vistas.add(c.id);
    if (state.currentCoverId) vistas.add(state.currentCoverId);
    state.capaVistas = [...vistas].slice(-MAX_CAPAS_VISTAS);
    return state;
  } catch {
    return { currentCoverId: null, changes: [], capaVistas: [] };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  /* tmp + rename: este arquivo é a memória da capa entre rodadas, e o loadState
     engole JSON truncado devolvendo estado vazio — um kill no meio da escrita
     direta zeraria a memória em silêncio e a capa voltaria ao começo do ciclo. */
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  require("./atomic-write").renomear(tmp, STATE_FILE);
}

/* Registra a capa que acabou de ir ao ar. Repetir a capa da rodada não conta como
   troca: o Actions roda build.js várias vezes por rodada. A trava é pela RODADA,
   não pelo registro anterior, porque uma rotação A→B seguida de um build que
   devolvesse a capa para A criaria uma segunda troca sem nada ter sido
   publicado — e A só tinha registro na rodada anterior. */
function registrarTroca(state, articleId, tipo, era = null) {
  const agora = new Date();
  const id = rodadaId(agora);
  const daRodada = (state.changes || []).filter((c) => rodadaDaEntrada(c) === id);
  if (daRodada.some((c) => c.id === articleId)) return false;
  state.changes.push({ at: agora.toISOString(), dia: id.slice(0, 10), rodada: id, id: articleId, tipo, era });
  const corte = Date.now() - 14 * DIA;
  state.changes = state.changes.filter((c) => Date.parse(c.at) >= corte);
  return true;
}

/* A rodada está servida quando a capa TROCOU dentro dela. Nada além disso:
   "publicou nesta rodada" não serve de régua, porque publicar não é capa (a nota
   pode estar abaixo do piso) e "o build rodou" não serve, porque o rebuild roda
   várias vezes por rodada sem trocar nada. */
function trocaNaRodada(state, date = new Date()) {
  const id = rodadaId(date);
  return (state.changes || []).some((c) => rodadaDaEntrada(c) === id);
}

function trocasNaRodada(state, date = new Date()) {
  const id = rodadaId(date);
  return (state.changes || []).filter((c) => rodadaDaEntrada(c) === id).length;
}

/* Última troca da rodada atual, ou null (o painel mostra quantas capas a rodada
   efetivamente pôs no ar). */
function ultimaTrocaNaRodada(state, date = new Date()) {
  const id = rodadaId(date);
  const daRodada = (state.changes || []).filter((c) => rodadaDaEntrada(c) === id);
  return daRodada.length ? daRodada[daRodada.length - 1] : null;
}

function shouldForceChange(state) {
  return !trocaNaRodada(state);
}

/* Esta matéria já esteve no hero? Se não, é novidade e toma a capa fora da
   ordem; se sim, só volta por rotação. É isto que impede o build de desfazer a
   rotação: no esquema por data ("a mais nova manda"), depois de girar A→B o
   build seguinte via A ainda como a mais nova do catálogo e punha A de volta,
   girando a rodada duas vezes sem publicar nada. `a.date` do catálogo tem
   granularidade de DIA, então comparar datas não distingue "publicada há cinco
   minutos" de "publicada na madrugada do mesmo dia" — a memória de ids é o que
   funciona. */
function jaFoiCapa(state, articleId) {
  if (articleId && articleId === state.currentCoverId) return true;
  return (state.capaVistas || []).includes(articleId);
}

/* O próximo passo da rotação: a lista `elegiveis` vem mais nova → mais velha
   (lib/cover-rules), então caminhar para frente é ir do atual para a mais velha
   e, no fim, voltar para a mais nova. Sem capa no ar (primeira rodada, ou a capa
   sumiu do catálogo), o topo da lista é o ponto de partida — a mais nova.       */
function proximaNaRotação(elegiveis, atualId) {
  if (!elegiveis.length) return null;
  const i = elegiveis.findIndex((a) => a.id === atualId);
  if (i === -1) return elegiveis[0];
  return elegiveis[(i + 1) % elegiveis.length];
}

/* Quem escreve o estado é só o build.js, com o id que efetivamente foi ao ar no
   slot index-hero. tipo = "rotacionada" (a rodada não tinha troca e o build
   caminhou na lista de elegíveis) ou "do dia" (matéria que ainda não tinha
   passado pelo hero — em geral recém-publicada). publish.js não escreve aqui: ele
   carimbava a matéria publicada MESMO quando ela não passava do piso, e a rodada
   se declarava servida sem troca nenhuma. Troca é o que o leitor vê: repetir a
   mesma capa — o caso de uma matéria elegível sozinha no catálogo, em que a
   rotação não tem para onde girar — não serve rodada nenhuma. */
function registrarCapa(state, articleId, tipo, mudouHero = true) {
  const era = state.currentCoverId;
  state.currentCoverId = articleId;
  let registrou = false;
  if (mudouHero && era !== articleId) registrou = registrarTroca(state, articleId, tipo, era);
  if (!Array.isArray(state.capaVistas)) state.capaVistas = [];
  if (!state.capaVistas.includes(articleId)) {
    state.capaVistas.push(articleId);
    if (state.capaVistas.length > MAX_CAPAS_VISTAS) state.capaVistas = state.capaVistas.slice(-MAX_CAPAS_VISTAS);
  }
  saveState(state);
  return registrou;
}

/* Quantas capas efetivamente foram ao ar no dia do fuso — É A RÉGUA DA META
   `cover_changes_per_day`, que com a rotação por rodada vale o número de rodadas
   do dia. Pode passar disso: publicar dentro de uma rodada que já girou é uma
   capa a mais, não uma meta a mais. Contar por janela dava 5 num dia e 7 no
   seguinte, porque a troca da madrugada pertencia à noite do dia anterior. */
function trocasNoDia(state, dia) {
  const alvo = dia || diaDaMeta();
  /* Pela rodada, nunca pelo `at`: são a mesma conta que `rodadasServidasNoDia`
     usa, e `rodadaDaEntrada` deriva do instante quando o campo falta (estado
     editado à mão), para as duas réguas não divergirem num detalhe do arquivo. */
  return (state.changes || []).filter((c) => String(rodadaDaEntrada(c) || "").startsWith(`${alvo}T`)).length;
}

/* Rodadas do dia que já tiveram capa: a meta cumprida em si, porque girar duas
   vezes numa rodada só não serve a segunda. */
function rodadasServidasNoDia(state, dia) {
  const alvo = dia || diaDaMeta();
  const ids = new Set();
  for (const c of state.changes || []) {
    const id = rodadaDaEntrada(c);
    if (id && id.startsWith(`${alvo}T`)) ids.add(id);
  }
  return ids.size;
}

/* O dia que a meta de capa está cobrando agora: o dia do fuso em que a RODADA em
   curso abriu — não o do relógio. Às 00:05 ainda está em curso a rodada das
   20:23 de ontem, e é ontem que ela serve. Ancorar no relógio contaria a mesma
   troca em dois dias diferentes (`rodadasServidasNoDia` olha a rodada,
   `trocasNoDia` olharia o instante) e o painel mostraria 6/6 e 5/6 ao mesmo
   tempo. O dia da meta vai, portanto, de 00:23 a 00:22. */
function diaDaMeta(date = new Date()) {
  return rodadaId(date).slice(0, 10);
}

module.exports = {
  FUSO,
  STATE_FILE,
  CADENCE_FILE,
  DIA_LOG_DIAS: 14,
  horariosDasRodadas,
  rodadasDoDia,
  rodadaId,
  rodadaDaEntrada,
  loadState,
  saveState,
  trocaNaRodada,
  trocasNaRodada,
  ultimaTrocaNaRodada,
  shouldForceChange,
  jaFoiCapa,
  proximaNaRotação,
  registrarCapa,
  trocasNoDia,
  rodadasServidasNoDia,
  diaDaMeta,
};
