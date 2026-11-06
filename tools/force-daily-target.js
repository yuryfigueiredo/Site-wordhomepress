/* Verifica se o dia atingiu o teto de publicações e a meta de trocas de capa.
   Se não, força o que falta. Uso: node tools/force-daily-target.js

   Meta diária (pipeline/cadence.json):
   - max_publishes_per_day: 5 matérias publicadas
   - min_hours_between_publishes: 4h (respeitado, a menos que --force-all)
   - cover_changes_per_day: 2 trocas de capa (hero-lead)

   O script coleta pautas novas se necessário, escreve drafts, e publica com
   --force-cadence quando o gap não é respeitado. A capa é forçada via
   pipeline/state/hero-override.json (lido pelo build.js). */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CADENCE = JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "cadence.json"), "utf8"));
const TARGET_PUBS = CADENCE.max_publishes_per_day || 5;
const TARGET_COVER_CHANGES = CADENCE.cover_changes_per_day || 2;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function publishedToday(root) {
  const d = today();
  let fromMemory = 0;
  try {
    const mem = JSON.parse(fs.readFileSync(path.join(root, "pipeline", "memory.json"), "utf8"));
    fromMemory = (mem.publishes || []).filter((p) => p.at?.startsWith(d)).length;
  } catch {}
  let fromCommits = 0;
  try {
    const subjects = execFileSync("git", ["log", `--since=${d}T00:00:00Z`, "--pretty=%s"], { cwd: root, stdio: "pipe" }).toString();
    fromCommits = subjects.split("\n").filter((l) => l.startsWith("publish:")).length;
  } catch {}
  return Math.max(fromMemory, fromCommits);
}

function currentHero(root) {
  try {
    const override = JSON.parse(fs.readFileSync(path.join(root, "pipeline", "state", "hero-override.json"), "utf8"));
    if (override.date === today()) return override.id;
  } catch {}
  return null;
}

function heroChangesToday(root) {
  const d = today();
  let changes = 0;
  try {
    const log = execFileSync("git", ["log", `--since=${d}T00:00:00Z`, "--pretty=%s"], { cwd: root, stdio: "pipe" }).toString();
    const commits = log.split("\n").filter((l) => l.startsWith("publish:"));
    const heroes = new Set();
    for (const c of commits) {
      const files = execFileSync("git", ["show", "--name-only", "--pretty=", c.split(" ")[1] || c], { cwd: root, stdio: "pipe" }).toString();
      if (files.includes("index.html")) {
        const heroMatch = execFileSync("git", ["show", `HEAD:index.html`], { cwd: root, stdio: "pipe" }).toString().match(/hero-lead__title[^>]*>[^<]*<a[^>]*id="([^"]+)"/);
        if (heroMatch) heroes.add(heroMatch[1]);
      }
    }
    changes = heroes.size;
  } catch {}
  return changes;
}

function collectAndPublish(root, count) {
  console.log(`[force] coletando pautas para ${count} publicação(ões)...`);
  try {
    execFileSync(process.execPath, [path.join(root, "tools", "ingest.js")], { cwd: root, stdio: "inherit" });
  } catch (e) {
    console.error("[force] ingest falhou:", e.message);
    return 0;
  }

  let published = 0;
  for (let i = 0; i < count; i++) {
    try {
      const pickRaw = execFileSync(process.execPath, [path.join(root, "tools", "pick-lead.js")], { cwd: root, stdio: "pipe" }).toString().trim();
      let pick = null;
      try {
        pick = JSON.parse(pickRaw);
      } catch {
        console.log(`[force] pick-lead não retornou JSON: ${pickRaw.slice(0, 100)}`);
        continue;
      }
      if (!pick || !pick.url || !pick.slug) {
        console.log(`[force] pick-lead retornou pauta inválida`);
        continue;
      }
      console.log(`[force] publicando ${pick.slug} (${i + 1}/${count})...`);
      try {
        execFileSync(process.execPath, [
          path.join(root, "tools", "new-post.js"),
          "--url", pick.url,
          "--pillar", pick.pillar || "science",
          "--topic", pick.topic || pick.slug,
        ], { cwd: root, stdio: "inherit" });
      } catch (e) {
        console.error(`[force] new-post falhou para ${pick.slug}:`, e.message.split("\n")[0]);
        continue;
      }
      try {
        execFileSync(process.execPath, [path.join(root, "tools", "publish.js"), pick.slug, "--force-cadence"], { cwd: root, stdio: "inherit" });
        published++;
      } catch (e) {
        console.error(`[force] publish falhou para ${pick.slug}:`, e.message.split("\n")[0]);
      }
    } catch (e) {
      console.error(`[force] publicação ${i + 1} falhou:`, e.message);
    }
  }
  return published;
}

function forceCoverChange(root, reason, avoidId) {
  console.log(`[force] trocando capa (${reason})...`);
  try {
    const mem = JSON.parse(fs.readFileSync(path.join(root, "pipeline", "memory.json"), "utf8"));
    const pubs = mem.publishes || [];
    if (pubs.length === 0) {
      console.log("[force] sem publicações para usar como capa");
      return false;
    }
    const candidates = avoidId ? pubs.filter((p) => p.id !== avoidId) : pubs;
    if (candidates.length === 0) {
      console.log(`[force] todas as publicações já foram capa (avoid: ${avoidId})`);
      return false;
    }
    const latest = candidates[candidates.length - 1];
    const override = { id: latest.id, date: today(), reason };
    const dir = path.join(root, "pipeline", "state");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "hero-override.json"), JSON.stringify(override, null, 2));
    console.log(`[force] capa forçada: ${latest.id}`);
    return true;
  } catch (e) {
    console.error("[force] erro ao forçar capa:", e.message);
    return false;
  }
}

const argv = process.argv.slice(2);
const forceAll = argv.includes("--force-all");

console.log(`[force] meta: ${TARGET_PUBS} publicações, ${TARGET_COVER_CHANGES} trocas de capa`);
const pubs = publishedToday(ROOT);
console.log(`[force] publicado hoje: ${pubs}/${TARGET_PUBS}`);

let missing = TARGET_PUBS - pubs;
if (missing > 0) {
  if (!forceAll && missing > 2) {
    console.log(`[force] faltam ${missing} publicações, mas o gap de ${CADENCE.min_hours_between_publishes}h pode não ter passado. Use --force-all para ignorar o gap.`);
    missing = 2;
  }
  const done = collectAndPublish(ROOT, missing);
  console.log(`[force] ${done}/${missing} publicações forçadas`);
} else {
  console.log("[force] meta de publicações atingida");
}

const changes = heroChangesToday(ROOT);
console.log(`[force] trocas de capa hoje: ${changes}/${TARGET_COVER_CHANGES}`);
if (changes < TARGET_COVER_CHANGES) {
  const needed = TARGET_COVER_CHANGES - changes;
  let lastHero = currentHero(ROOT);
  for (let i = 0; i < needed; i++) {
    if (forceCoverChange(ROOT, `meta ${TARGET_COVER_CHANGES}x/dia, falta ${needed - i}`, lastHero)) {
      lastHero = currentHero(ROOT);
    }
  }
}

console.log("[force] fim");
