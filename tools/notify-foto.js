/* notify-foto.js — alerta o dono quando a busca de foto real falha e a
   publicação é travada. Abre uma issue no repositório: o GitHub manda
   e-mail sozinho, sem serviço novo e sem credencial extra.
   Uso: node tools/notify-foto.js <slug> "<título>" '<log JSON>'
   Local: usa o gh autenticado. Actions: usa GITHUB_TOKEN. */
const { execFileSync } = require("child_process");

const ROOT = require("path").resolve(__dirname, "..");
const [SLUG, TITULO, LOG_RAW] = process.argv.slice(2);
if (!SLUG) {
  console.error("uso: node tools/notify-foto.js <slug> \"<título>\" '<log JSON>'");
  process.exit(2);
}

let log = [];
try {
  log = JSON.parse(LOG_RAW || "[]");
} catch {}

const ISSUE_TITLE = `Sem foto real: publicação travada (${SLUG})`;
const corpo = [
  `A matéria **${TITULO || SLUG}** não conseguiu foto real, então o \`publish.js\` travou a publicação em vez de subir a placa SVG.`,
  "",
  "## Tentativas de busca",
  ...(log.length
    ? log.map((t) => `- query: \`${t.query}\` → ${t.attempts.join(" | ")}`)
    : ["- (sem log de tentativas)"]),
  "",
  "## O que fazer",
  "- Se o motivo for `sem UNSPLASH_ACCESS_KEY` / `HTTP 401` / `HTTP 429`: a chave sumiu, expirou ou a cota grátis acabou.",
  "- Se for `0 resultados` em todas as queries: vale escrever uma query à mão (ex.: `node tools/find-cover.js <slug>` depois de editar `photoQuery` no draft).",
  "- Nada foi publicado e nada precisa ser desfeito.",
].join("\n");

function repoFromGit() {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd: ROOT, encoding: "utf8" }).trim();
    const m = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const REPO = process.env.GITHUB_REPOSITORY || repoFromGit();

function viaGh() {
  const existente = execFileSync("gh", ["issue", "list", "--repo", REPO, "--state", "open", "--search", `in:title ${SLUG}`, "--json", "number"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (JSON.parse(existente).length) return `issue já aberta para ${SLUG}`;
  execFileSync("gh", ["issue", "create", "--repo", REPO, "--title", ISSUE_TITLE, "--body", corpo], { cwd: ROOT, encoding: "utf8" });
  return `issue criada em ${REPO}`;
}

async function viaToken() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("sem gh autenticado e sem GITHUB_TOKEN");
  const base = `https://api.github.com/repos/${REPO}/issues`;
  const lista = await fetch(`${base}?state=open&per_page=100`, { headers: { Authorization: `Bearer ${token}` } });
  const abertas = lista.ok ? await lista.json() : [];
  if (abertas.some((i) => i.title.includes(SLUG))) return `issue já aberta para ${SLUG}`;
  const res = await fetch(base, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/vnd.github+json" },
    body: JSON.stringify({ title: ISSUE_TITLE, body: corpo }),
  });
  if (!res.ok) throw new Error(`REST HTTP ${res.status}`);
  return `issue criada em ${REPO}`;
}

(async () => {
  if (!REPO) {
    console.error("notify-foto: não identifiquei o repositório (remote origin sem github) — alerta NÃO enviado");
    process.exit(1);
  }
  try {
    console.log(viaGh());
  } catch (err) {
    const msg = `${err.stdout || ""}${err.stderr || ""}${err.message || ""}`.trim();
    if (/gh: |command not found|not logged in|Unknown command/.test(msg)) {
      try {
        console.log(await viaToken());
      } catch (err2) {
        console.error(`notify-foto: alerta NÃO enviado — ${String(err2.message).split("\n")[0]}`);
        process.exit(1);
      }
    } else {
      console.error(`notify-foto: alerta NÃO enviado — ${msg.slice(0, 200)}`);
      process.exit(1);
    }
  }
})();
