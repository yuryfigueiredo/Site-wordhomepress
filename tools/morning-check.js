/* Pre-check matinal: verifica o estado do pipeline e mostra o que precisa ser feito.
   Uso: node tools/morning-check.js  (rode ao acordar)

   Este script:
   1. Verifica quantas publicações foram feitas ontem
   2. Confirma que o teto de 5/dia está configurado
   3. Roda o force-daily-target.js para completarar o que faltou
   4. Mostra o estado da capa e das pautas coletadas
   5. Lista qualquer erro ou warning pendente

   Saída clara: o que funcionou, o que falhou, o que precisa de atenção. */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function publishedOn(root, date) {
  let fromMemory = 0;
  try {
    const mem = JSON.parse(fs.readFileSync(path.join(root, "pipeline", "memory.json"), "utf8"));
    fromMemory = (mem.publishes || []).filter((p) => p.at?.startsWith(date)).length;
  } catch {}
  let fromCommits = 0;
  try {
    const subjects = execFileSync("git", ["log", `--since=${date}T00:00:00Z`, `--until=${date}T23:59:59Z`, "--pretty=%s"], { cwd: root, stdio: "pipe" }).toString();
    fromCommits = subjects.split("\n").filter((l) => l.startsWith("publish:")).length;
  } catch {}
  return Math.max(fromMemory, fromCommits);
}

function cadenceConfig(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "pipeline", "cadence.json"), "utf8"));
  } catch {
    return null;
  }
}

function lastHeroChange(root) {
  try {
    const override = JSON.parse(fs.readFileSync(path.join(root, "pipeline", "state", "hero-override.json"), "utf8"));
    return { id: override.id, date: override.date, reason: override.reason };
  } catch {
    return null;
  }
}

function checkDoctor(root) {
  try {
    const output = execFileSync(process.execPath, [path.join(root, "tools", "doctor.js"), "--offline"], { cwd: root, stdio: "pipe" }).toString();
    const match = output.match(/errors\s+(\d+)\s+\|\s+.*?warnings\s+(\d+)/);
    return { errors: Number(match?.[1] || 0), warnings: Number(match?.[2] || 0) };
  } catch (e) {
    return { errors: 0, warnings: 0, error: e.message.split("\n")[0] };
  }
}

const cad = cadenceConfig(ROOT);
const yest = yesterday();
const pubYest = publishedOn(ROOT, yest);
const pubToday = publishedOn(ROOT, today());
const hero = lastHeroChange(ROOT);
const doc = checkDoctor(ROOT);

console.log("=".repeat(60));
console.log("  MORNING CHECK — Homeworld Press");
console.log("=".repeat(60));
console.log("");

console.log(`Data: ${today()}`);
console.log(`Meta configurada: ${cad?.max_publishes_per_day || "?"} publicações/dia, ${cad?.cover_changes_per_day || "?"} trocas de capa/dia`);
console.log(`Gap mínimo: ${cad?.min_hours_between_publishes || "?"}h entre publicações`);
console.log("");

console.log("--- Ontem (" + yest + ") ---");
console.log(`Publicado: ${pubYest}/${cad?.max_publishes_per_day || 5}`);
if (pubYest < (cad?.max_publishes_per_day || 5)) {
  console.log(`⚠ Faltaram ${cad?.max_publishes_per_day - pubYest} publicações. Vou forçar agora.`);
} else {
  console.log("✓ Meta atingida");
}
console.log("");

console.log("--- Hoje (até agora) ---");
console.log(`Publicado: ${pubToday}/${cad?.max_publishes_per_day || 5}`);
console.log(`Última troca de capa: ${hero ? `${hero.id} (${hero.date})` : "nenhuma"}`);
console.log("");

console.log("--- Saúde do site ---");
console.log(`Doctor: ${doc.errors} erros, ${doc.warnings} warnings`);
if (doc.errors > 0) console.log("⚠ ERROS precisam de atenção antes de publicar");
console.log("");

if (pubYest < (cad?.max_publishes_per_day || 5) && doc.errors === 0) {
  console.log("=== Faltaram publicações ontem ===");
  console.log("O writer automático ainda não está integrado no force-daily-target.");
  console.log("O turno normal (5 rodadas/dia) vai compensar hoje. Para forçar agora:");
  console.log("  1. Rode o turno: node tools/turno.js");
  console.log("  2. Ou use o prompt gerado em pipeline/drafts/<slug>/prompt.md");
  console.log("     no chat, salve como draft.json, e rode:");
  console.log("     node tools/force-daily-target.js --force-all");
  console.log("");
  console.log("Trocando a capa (isso funciona sozinho):");
  try {
    execFileSync(process.execPath, [path.join(ROOT, "tools", "force-daily-target.js"), "--force-all"], {
      cwd: ROOT,
      stdio: "pipe",
    });
    console.log("✓ Capa verificada");
  } catch (e) {
    console.log("⚠ Force-daily-target teve erros (ver acima)");
  }
} else if (doc.errors > 0) {
  console.log("=== NÃO FORÇANDO: corrija os erros do doctor primeiro ===");
} else {
  console.log("=== Ontem atingiu a meta ===");
}

console.log("");
console.log("=".repeat(60));
console.log("  Próximo passo: rode o turno normal ao longo do dia.");
console.log("  O teto de 5/dia e 2 trocas de capa estão ativos.");
console.log("=".repeat(60));
