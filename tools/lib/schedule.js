/* schedule.js — uma régua só para "quantas publicações a agenda permite".

   Medido no Actions entre 2026-10-30 e 2026-11-06: dos 5 horários do cron
   (07, 10, 14, 17, 21 UTC), 07/10/17 nunca dispararam e os que dispararam
   chegaram de 1 a 170 minutos atrasados. Com min_hours_between_publishes = 4,
   a meta de 5 publicações por dia era impossível por construção: o teto media o
   desejo, não a agenda. Este módulo converte o cron em número e o doctor
   compara o número com o teto — o erro vira vermelho em vez de virar "rodada
   verde sem publicação" pela terceira semana seguida.                           */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

/* "23 3,7,11,15,19,23 * * *" → minutos de UTC [{min}, ...] ordenados.
   Suporta só o formato que este repositório usa: minuto fixo e lista de horas.
   Qualquer outra coisa devolve null, e o portão avisa em vez de chutar.        */
function parseCron(cron) {
  const partes = String(cron || "").trim().split(/\s+/);
  if (partes.length !== 5) return null;
  const [minField, hourField] = partes;
  const minuto = Number(minField);
  if (!Number.isInteger(minuto) || minuto < 0 || minuto > 59) return null;
  if (!/^\d{1,2}(,\d{1,2})*$/.test(hourField)) return null;
  const horas = hourField.split(",").map(Number);
  if (horas.some((h) => !(h >= 0 && h <= 23))) return null;
  return { minutos: horas.map((h) => h * 60 + minuto).sort((a, b) => a - b), horas };
}

/* Máximo de publicações por dia que a agenda entrega, respeitando a distância
   mínima entre duas peças. Guloso a partir de cada horário: o padrão se repete a
   cada 24h, então a maior janela de 24h é a resposta honesta.                   */
function maxPublicacoesPorAgenda(minutosCron, minHours) {
  if (!Array.isArray(minutosCron) || !minutosCron.length) return 0;
  const gapMin = Math.max(0, Math.round((Number(minHours) || 0) * 60));
  const DIA = 1440;
  const linha = [];
  for (let dia = 0; dia < 4; dia++) for (const m of minutosCron) linha.push(dia * DIA + m);
  let melhor = 0;
  for (const inicio of minutosCron) {
    let pegos = 0;
    let ultimo = -Infinity;
    for (const t of linha) {
      if (t < inicio || t >= inicio + DIA) continue;
      if (t - ultimo < gapMin) continue;
      pegos++;
      ultimo = t;
    }
    melhor = Math.max(melhor, pegos);
  }
  return melhor;
}

/* Menor distância real entre dois horários consecutivos do cron, em horas —
   incluindo a volta do dia (23:23 → 03:23 = 4h).                               */
function menorIntervaloEntreHorarios(minutosCron) {
  if (!Array.isArray(minutosCron) || minutosCron.length < 2) return null;
  const DIA = 1440;
  const ordenado = [...minutosCron].sort((a, b) => a - b);
  let menor = ordenado[0] + DIA - ordenado[ordenado.length - 1];
  for (let i = 1; i < ordenado.length; i++) menor = Math.min(menor, ordenado[i] - ordenado[i - 1]);
  return menor / 60;
}

/* Lê o cron do workflow real — a agenda que o GitHub executa é a única que vale. */
function cronDoWorkflow(root) {
  const rel = path.join(".github", "workflows", "turno.yml");
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) return { error: `${rel} não existe` };
  const m = fs.readFileSync(file, "utf8").match(/^\s*-\s*cron:\s*["']([^"']+)["']/m);
  if (!m) return { error: "nenhum cron encontrado em on.schedule" };
  return { cron: m[1] };
}

/* Quantas rodadas o robô realmente percorreu por dia, medidas pelos commits
   "turno:". O cron promete; o histórico entrega.                                */
function rodadasObservadas(root, dias = 7) {
  let linhas;
  try {
    linhas = execFileSync("git", ["log", `--since=${dias} days ago`, "--pretty=%ad%x09%s", "--date=iso-strict"], {
      cwd: root,
      stdio: "pipe",
    })
      .toString()
      .split("\n");
  } catch {
    return null;
  }
  const diasComRodada = new Set();
  let rodadas = 0;
  for (const linha of linhas) {
    const aba = linha.indexOf("\t");
    if (aba < 0 || !linha.slice(aba + 1).startsWith("turno:")) continue;
    rodadas++;
    diasComRodada.add(linha.slice(0, 10));
  }
  if (!rodadas) return null;
  return { rodadas, dias: diasComRodada.size, porDia: rodadas / dias };
}

/* Minuto de UTC → "08:23" no fuso declarado. Serve para conferir check_hours,
   que é o que o painel local mostra ao dono.                                    */
function horaNoFuso(minutoUTC, timezone) {
  /* A âncora é HOJE, não uma data fixa: com 2000-01-01 o Intl devolvia o
     horário de verão brasileiro daquele ano (UTC-2) e a agenda inteira saía 1h
     adiantada na comparação — régua que confere contra si mesma. */
  const agora = new Date();
  const d = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 0, ((minutoUTC % 1440) + 1440) % 1440));
  try {
    const s = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(d);
    return s.replace(/\s/g, "").slice(0, 5);
  } catch {
    return null;
  }
}

module.exports = {
  parseCron,
  maxPublicacoesPorAgenda,
  menorIntervaloEntreHorarios,
  cronDoWorkflow,
  rodadasObservadas,
  horaNoFuso,
};
