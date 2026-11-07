/* morning-check.js — painel da manhã. Só lê réguas e diz o que falta.

   Até 2026-11-07 este script existia em par com tools/force-daily-target.js,
   que publicava no tapa com --force-cadence, media a capa por arqueologia de git
   (quebrada: `c.split(" ")[1]` não é um sha) e escrevia
   pipeline/state/hero-override.json — arquivo que nenhuma ferramenta de build
   jamais leu. Nada disso estava agendado em lugar nenhum (0 de 374 tarefas do
   Windows) e tudo terminava com exit 0. A régua da meta passou a ser a própria
   rodada: tools/turno.js com o teto de pipeline/cadence.json, a troca forçada de
   capa em tools/build.js + lib/cover-state.js e o portão de agenda do
   tools/doctor.js. Aqui sobram só os números.

   Uso: node tools/morning-check.js        (morning.bat faz isso)             */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const mem = require("./lib/memory");
const cadence = require("./lib/cadence");
const cover = require("./lib/cover-state");
const schedule = require("./lib/schedule");

const barra = (n) => "=".repeat(n);
const lido = (rel, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  } catch {
    return fallback;
  }
};

const cad = lido("pipeline/cadence.json", {});
const hojeUTC = new Date().toISOString().slice(0, 10);
const ontemUTC = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const diaFuso = cover.hojeNoFuso();
const teto = Number(cad.max_publishes_per_day) || 0;
const metaCapa = Number(cad.cover_changes_per_day) || 0;

const ag = schedule.cronDoWorkflow(ROOT);
const slots = ag.cron ? schedule.parseCron(ag.cron) : null;
const possivel = slots ? schedule.maxPublicacoesPorAgenda(slots.minutos, cad.min_hours_between_publishes) : null;
const obs = schedule.rodadasObservadas(ROOT, 7);
/* A fila que o robô vê não é a de "hoje em UTC": pick-lead.js varre as 3 filas
   mais recentes, e uma coleta feita madrugada afora grava no dia anterior. */
const fila = (() => {
  const dir = path.join(ROOT, "pipeline", "leads");
  const arquivos = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().reverse().slice(0, 3) : [];
  const pautas = arquivos.flatMap((f) => (lido(`pipeline/leads/${f}`, {}).leads || []));
  return { arquivos, pautas };
})();
const estado = cover.loadState();
const trocasHoje = cover.trocasNoDia(estado, diaFuso);
const gap = cadence.horasDesdeUltimaPublicacao(ROOT);

const saidaDoctor = (() => {
  try {
    return execFileSync(process.execPath, [path.join(ROOT, "tools", "doctor.js"), "--offline"], { cwd: ROOT, stdio: "pipe" }).toString();
  } catch (err) {
    return `${err.stdout || ""}${err.stderr || ""}`;
  }
})();
const nums = saidaDoctor.match(/errors\s+(\d+)\s+\|.*?warnings\s+(\d+)/) || [];

console.log(barra(64));
console.log("  MANHÃ — Homeworld Press");
console.log(barra(64));
console.log(`Dia no fuso ${cad.timezone}: ${diaFuso} · janela ${cover.currentWindow()} (abriu ${cover.windowStart()})`);
console.log("");
console.log(`Publicações — ontem ${mem.publicacoesNoDia(ROOT, ontemUTC)}/${teto} · agora ${cadence.publishedToday(ROOT)}/${teto} (dia UTC ${hojeUTC})`);
console.log(`Última matéria no ar há ${gap === null ? "?" : gap.toFixed(1)}h (mínimo ${cad.min_hours_between_publishes}h entre peças)`);
console.log(`Trocas de capa — hoje ${trocasHoje}/${metaCapa} · ${estado.changes.length} troca(s) nos últimos 14 dias`);
console.log(`Fila — ${fila.pautas.length} pauta(s) coletada(s) em ${fila.arquivos.length || 0} arquivo(s): ${fila.arquivos.join(", ") || "nenhum"}`);
console.log("        ( leitura só do que está na fila: `node tools/ingest.js --show` — pick-lead.js NÃO é de ler:");
console.log("         ele compromete a pauta com a rodada e a deixa fora da fila por lead_retry_hours)");
console.log(`Manutenção — ${nums[1] ?? "?"} erro(s), ${nums[2] ?? "?"} aviso(s)`);
console.log("");
console.log(`Agenda do Actions: ${ag.error || ag.cron}`);
if (possivel !== null)
  console.log(`  com ${cad.min_hours_between_publishes}h de distância entre peças, no máximo ${possivel} publicações/dia (teto declarado: ${teto})`);
if (obs) console.log(`  entrega medida em 7 dias: ${obs.porDia.toFixed(1)} rodadas/dia (${obs.rodadas} rodadas)`);
console.log("");

const errosDoctor = Number(nums[1] || 0);
const falta = teto - cadence.publishedToday(ROOT);
console.log(barra(64));
if (errosDoctor > 0) {
  console.log("ERRO ABERTO NO DOCTOR — com ele a rodada não publica nada. Leia:");
  console.log("  node tools/doctor.js --offline");
} else if (falta > 0) {
  console.log(`Faltam ${falta} publicações para o teto de hoje. A rodada faz tudo sozinha:`);
  console.log("  node tools/turno.js");
  if (possivel !== null && teto > possivel)
    console.log(`⚠ O teto (${teto}) passa do que a agenda entrega (${possivel}): ajuste pipeline/cadence.json ou o cron do workflow.`);
} else {
  console.log("✓ Teto de publicações de hoje atingido — as próximas rodadas só coletam e checam.");
}
if (trocasHoje < metaCapa) {
  console.log(`Capa: ${trocasHoje}/${metaCapa} troca(s). build.js troca sozinho na próxima rodada, desde que exista`);
  console.log(`    mais de uma matéria com nota medida >= ${cad.cover_baseline} e foto. Não trocou? O motivo está em`);
  console.log("    pipeline/state/cover-state.json e nas notas de pipeline/scores.json.");
} else {
  console.log(`✓ Capa: ${trocasHoje}/${metaCapa} troca(s) hoje — meta cumprida.`);
}
console.log(barra(64));
console.log("Painel de leitura: nada aqui escreve, publica ou empurra.");
