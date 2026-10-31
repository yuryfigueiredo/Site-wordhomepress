/* Quanto já foi publicado hoje. O log local (pipeline/state/) é gitignored e
   nasce vazio em cada rodada do CI, então o teto diário nunca disparava lá.
   O histórico de commits é a fonte que existe nos dois lugares. */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function publishedToday(root) {
  const today = new Date().toISOString().slice(0, 10);

  let fromLog = 0;
  try {
    const log = JSON.parse(fs.readFileSync(path.join(root, "pipeline", "state", "publish-log.json"), "utf8"));
    fromLog = (log.days || {})[today] || 0;
  } catch {}

  let fromCommits = 0;
  try {
    const subjects = execFileSync("git", ["log", `--since=${today}T00:00:00Z`, "--pretty=%s"], { cwd: root, stdio: "pipe" }).toString();
    fromCommits = subjects.split("\n").filter((l) => l.startsWith("publish:")).length;
  } catch {}

  return Math.max(fromLog, fromCommits);
}

module.exports = { publishedToday };
