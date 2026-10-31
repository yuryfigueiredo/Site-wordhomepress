/* Quanto já foi publicado hoje, e há quanto tempo.

   Duas fontes, porque cada uma falta de um lado diferente:
   · pipeline/memory.json — escrita pelo publish.js, versionada, única memória
     que existe no runner do Actions entre rodadas;
   · commits "publish:" — pega publicação feita à mão, sem passar pelo robô.
   O log local de antes (pipeline/state/publish-log.json) era gitignored: nascia
   vazio em todo turno na nuvem e o teto diário lia 0/1 mesmo depois de publicar
   (medido em 2026-10-31, no turno das 13:37 UTC).                       */
const { execFileSync } = require("child_process");
const mem = require("./memory");

function publishedToday(root, dia) {
  const today = dia || new Date().toISOString().slice(0, 10);
  const fromMemory = mem.publicacoesNoDia(root, today);

  /* O histórico só vale para o dia de hoje: --since com uma data antiga contaria
     todas as publicações desde lá e travaria a cadência para sempre. */
  let fromCommits = 0;
  if (today === new Date().toISOString().slice(0, 10)) {
    try {
      const subjects = execFileSync("git", ["log", `--since=${today}T00:00:00Z`, "--pretty=%s"], { cwd: root, stdio: "pipe" }).toString();
      fromCommits = subjects.split("\n").filter((l) => l.startsWith("publish:")).length;
    } catch {}
  }

  return Math.max(fromMemory, fromCommits);
}

/* Horas desde a última peça, ou null quando não há registro. Serve para o teto
   não ser driblado pela virada do dia UTC: com rodadas às 21:00 e 00:36, duas
   matérias caíam no ar com 43 minutos de diferença. */
function horasDesdeUltimaPublicacao(root) {
  return mem.ultimaPublicacaoEm(root);
}

module.exports = { publishedToday, horasDesdeUltimaPublicacao };
