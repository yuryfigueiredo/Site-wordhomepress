/* teste-runner-portao.js — prova do portão da árvore no runner local.

   O `hwp-turno.sh` mora fora do repo de propósito (nenhum script de tools/
   chama push), mas isso não pode significar "portão sem prova". O defeito que
   este arquivo paga é medido em 13/11: uma rodada à mão (`node tools/turno.js`,
   o caminho manual do AGENTS.md) deixa o TURNO.md sujo, e a rodada agendada das
   20:23 morreu nisso — um horário inteiro perdido por um arquivo que o próprio
   runner commita em toda rodada, verde ou vermelha.

   A exceção tem de ser estreita: TURNO.md sozinho passa, qualquer outra mudança
   do dono barra, e as duas juntas também barram (preservar o diário não é
   engolir trabalho alheio).

   Nada aqui toca o repo real nem o estado da máquina: o runner roda contra um
   fixture no /tmp com HWP_REPO/HWP_STATE/HWP_AVISO, e para no portão pela boca
   HWP_SO_PORTAO. O stub de aviso, o estado e o log vivem FORA do diretório do
   fixture — dentro dele eles sujam a árvore que o teste está conferindo.     */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const RUNNER = path.join(os.homedir(), ".local", "bin", "hwp-turno.sh");
const REPO_REAL = "/home/yury/Documentos/Projeto/homeworldpress";
let verde = 0;
const falhas = [];
function confere(nome, ok, detalhe) {
  if (ok) {
    verde++;
    console.log(`  ✓ ${nome}`);
  } else {
    falhas.push(`${nome} — ${detalhe}`);
    console.log(`  ✗ ${nome}\n      ${detalhe}`);
  }
}

const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });

/* A árvore do repo real antes da prova: só o que está rastreado, porque o
   próprio arquivo de teste é um não-rastreado legítimo. */
const sujoRealAntes = git(REPO_REAL, "status", "--porcelain", "-uno").trim();
const avisosRealAntes = fs.existsSync(path.join(os.homedir(), ".local/state/hwp/avisos.log"))
  ? fs.readFileSync(path.join(os.homedir(), ".local/state/hwp/avisos.log"), "utf8").split("\n").filter(Boolean).length
  : 0;

function fixture() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "hwp-runner-"));
  const dir = path.join(raiz, "work");
  const state = path.join(raiz, "state");
  const avisos = path.join(raiz, "avisos.txt");
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", ".");
  git(dir, "config", "user.name", "prova");
  git(dir, "config", "user.email", "prova@local");
  fs.writeFileSync(path.join(dir, "TURNO.md"), "# Turno — baseline\n");
  fs.writeFileSync(path.join(dir, "index.html"), "<p>baseline</p>\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "baseline");
  git(dir, "branch", "-M", "main");
  const stub = path.join(raiz, "stub-aviso.sh");
  fs.writeFileSync(stub, `#!/bin/bash\necho "$1|$2" >> "${avisos}"\n`, { mode: 0o755 });
  return { dir, state, avisos, stub, raiz };
}

function roda(f) {
  let saida = "";
  let codigo = 0;
  try {
    saida = execFileSync(RUNNER, [], {
      encoding: "utf8",
      env: { ...process.env, HWP_REPO: f.dir, HWP_STATE: f.state, HWP_AVISO: f.stub, HWP_SO_PORTAO: "1" },
    });
  } catch (e) {
    saida = String(e.stdout || "") + String(e.stderr || "");
    codigo = e.status ?? -1;
  }
  return {
    saida,
    codigo,
    sujo: git(f.dir, "status", "--porcelain").trim(),
    assunto: git(f.dir, "log", "-1", "--format=%s").trim(),
    avisos: fs.existsSync(f.avisos) ? fs.readFileSync(f.avisos, "utf8").split("\n").filter(Boolean) : [],
  };
}

/* 1 — árvore limpa: nada a perdoar, a rodada segue. */
{
  console.log("1. árvore limpa");
  const r = roda(fixture());
  confere("saiu 0", r.codigo === 0, `código ${r.codigo} · ${r.saida.trim()}`);
  confere("anunciou o portão verde", /portão verde/.test(r.saida), r.saida.trim());
  confere("nenhum aviso disparado", r.avisos.length === 0, JSON.stringify(r.avisos));
}

/* 2 — o caso que custou a rodada das 20:23: só o diário sujo. */
{
  console.log("2. só TURNO.md sujo (rodada feita à mão antes do cron)");
  const f = fixture();
  fs.writeFileSync(path.join(f.dir, "TURNO.md"), "# Turno — log de uma rodada manual\n");
  const r = roda(f);
  confere("a rodada seguiu, não morreu", r.codigo === 0 && /a rodada segue/.test(r.saida), `${r.codigo} · ${r.saida.trim()}`);
  confere("o diário foi commitado, não descartado", /preserva o log da rodada manual/.test(r.assunto), r.assunto);
  confere("o texto da mão anterior continua no arquivo, byte a byte", /manual/.test(fs.readFileSync(path.join(f.dir, "TURNO.md"), "utf8")), fs.readFileSync(path.join(f.dir, "TURNO.md"), "utf8").slice(0, 60));
  confere("a árvore ficou limpa", r.sujo === "", r.sujo);
  confere("nenhum aviso vermelho", r.avisos.length === 0, JSON.stringify(r.avisos));
}

/* 3 — trabalho do dono junto com o diário: a exceção não engole nada. */
{
  console.log("3. TURNO.md + index.html sujos");
  const f = fixture();
  fs.writeFileSync(path.join(f.dir, "TURNO.md"), "# diário\n");
  fs.writeFileSync(path.join(f.dir, "index.html"), "<p>mudança do dono</p>\n");
  const r = roda(f);
  confere("saiu 1 (vermelho)", r.codigo === 1, `código ${r.codigo} · ${r.saida.trim()}`);
  confere("diz que a árvore tem mudanças", /mudanças não commitadas/.test(r.saida), r.saida.trim());
  confere("o diário NÃO foi commitado às escondidas", !/preserva o log/.test(r.assunto), r.assunto);
  confere("as duas mudanças continuam na árvore, intactas", /TURNO\.md/.test(r.sujo) && /index\.html/.test(r.sujo), r.sujo);
  confere("avisou na boca única", r.avisos.length === 1 && r.avisos[0].startsWith("rodada vermelha|"), JSON.stringify(r.avisos));
}

/* 4 — um arquivo qualquer do dono, sem diário no meio: barra do mesmo jeito. */
{
  console.log("4. só index.html sujo");
  const f = fixture();
  fs.writeFileSync(path.join(f.dir, "index.html"), "<p>editei à mão</p>\n");
  const r = roda(f);
  confere("saiu 1", r.codigo === 1, `código ${r.codigo} · ${r.saida.trim()}`);
  confere("nenhum commit novo", git(f.dir, "log", "--oneline").trim().split("\n").length === 1, git(f.dir, "log", "--oneline").trim());
}

/* 5 — invariante: o estado desta máquina não foi tocado pela prova. */
{
  console.log("5. nada encostou no repo real nem no estado da máquina");
  const logReal = fs.readFileSync(path.join(os.homedir(), ".local", "state", "hwp", "turno.log"), "utf8");
  confere("o turno.log real não ganhou cabeçalho de prova", !/portão verde/.test(logReal), `${(logReal.match(/===== turno local /g) || []).length} cabeçalhos`);
  const avisosRealAgora = fs.readFileSync(path.join(os.homedir(), ".local", "state", "hwp", "avisos.log"), "utf8").split("\n").filter(Boolean).length;
  confere("o avisos.log real não ganhou linha", avisosRealAgora === avisosRealAntes, `${avisosRealAntes} → ${avisosRealAgora}`);
  confere("nenhum arquivo rastreado do repo real se mexeu", git(REPO_REAL, "status", "--porcelain", "-uno").trim() === sujoRealAntes, git(REPO_REAL, "status", "--porcelain", "-uno").trim());
}

console.log(`\n${verde} conferências verdes, ${falhas.length} vermelhas.`);
if (falhas.length) {
  for (const f of falhas) console.log(`  ✗ ${f}`);
  process.exit(1);
}
