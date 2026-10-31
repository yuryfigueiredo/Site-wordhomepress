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
  const fromMemory = mem.ultimaPublicacaoEm(root);
  if (fromMemory !== null) return fromMemory;
  /* memory.json ilegível, apagado ou fora do ar: o histórico é a segunda fonte,
     pelo mesmo motivo do teto — com ele zerado as duas travas (teto e gap)
     abrem juntas e a primeira rodada da manhã publica sem freio nenhum.
     O clone do Actions vem com fetch-depth: 0, então o log existe.
     --grep não serve: ele varre o corpo da mensagem e casaria com um "fix:"
     qualquer que mencione o commit publish:. Filtra-se pelo assunto, como em
     publishedToday, e o log vem do mais recente para o mais antigo. */
  try {
    const linhas = execFileSync("git", ["log", "-n", "200", "--date=iso-strict", "--pretty=%ad%x09%s"], {
      cwd: root,
      stdio: "pipe",
    })
      .toString()
      .split("\n");
    for (const l of linhas) {
      const aba = l.indexOf("\t");
      if (aba < 0 || !l.slice(aba + 1).startsWith("publish:")) continue;
      const ms = Date.parse(l.slice(0, aba));
      if (!isNaN(ms)) return (Date.now() - ms) / 3600000;
      break;
    }
  } catch {}
  return null;
}

module.exports = { publishedToday, horasDesdeUltimaPublicacao };
