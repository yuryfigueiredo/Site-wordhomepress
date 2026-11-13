/* teste-vigia-local.js — prova de que o vigia do relógio local vê rodada perdida.

   O relógio do site passou a ser um portátil (13/11), então a falha nova do
   sistema é "a rodada não aconteceu e ninguém contou". O hwp-vigia.sh existe
   para isso, e um portão que não pode ser mutado é um portão que ninguém provou
   aberto — é a mesma régua do resto do repo: planta o defeito, vê a cor mudar.

   Cada caso roda o script de verdade, com as cinco entradas de teste do próprio
   script (HWP_REPO, HWP_VIGIA_STATE, HWP_VIGIA_GRACA, HWP_AVISO, PATH com
   shim). Nada aqui toca o estado real: o log, a chave de dedupe e os avisos
   vivem num diretório no /tmp, e o aviso é um stub que grava linha em arquivo
   em vez de notificar a área de trabalho.

   Uso: node .audit/teste-vigia-local.js                                     */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const VIGIA = path.join(os.homedir(), ".local", "bin", "hwp-vigia.sh");
const REPO = process.argv[2] || "/home/yury/Documentos/Projeto/homeworldpress";
const DIA_BASE_UTC = new Date().toISOString().slice(0, 10);

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

function cabeçalho(minutosAtras) {
  const t = new Date(Date.now() - minutosAtras * 60000).toISOString().replace(/\.\d+Z$/, "Z");
  return `===== turno local ${t} =====\n`;
}

/* Um repo mínimo com pipeline/cadence.json, um commit empurrado e (opcional)
   um commit local que o origin nunca viu — é o retrato do push que falhou. */
function fixtureRepo(dir, commitsLocais) {
  fs.mkdirSync(path.join(dir, "pipeline"), { recursive: true });
  fs.copyFileSync(path.join(REPO, "pipeline", "cadence.json"), path.join(dir, "pipeline", "cadence.json"));
  const git = (args, cwd) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  execFileSync("git", ["init", "-q", "--bare", path.join(dir, "..", "orig.git")]);
  git(["init", "-q", "."], dir);
  git(["config", "user.name", "prova"], dir);
  git(["config", "user.email", "prova@local"], dir);
  fs.writeFileSync(path.join(dir, "baseline.txt"), "1\n");
  git(["add", "-A"], dir);
  git(["commit", "-qm", "baseline"], dir);
  git(["branch", "-M", "main"], dir);
  git(["remote", "add", "origin", path.join(dir, "..", "orig.git")], dir);
  git(["push", "-q", "origin", "main"], dir);
  for (let i = 0; i < commitsLocais; i++) {
    fs.writeFileSync(path.join(dir, `local-${i}.txt`), "x\n");
    git(["add", "-A"], dir);
    git(["commit", "-qm", `commit local ${i} (não empurrado)`], dir);
  }
  return dir;
}

function cenario(nome, { turnoLog, repo, grace = 0, fusoFalso, chavePronta }) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "hwp-vigia-"));
  const state = path.join(raiz, "state");
  const avisos = path.join(raiz, "avisos.txt");
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, "turno.log"), turnoLog || "");
  if (chavePronta) fs.writeFileSync(path.join(state, "vigia-ultimo"), chavePronta);

  const stub = path.join(raiz, "stub-aviso.sh");
  fs.writeFileSync(stub, `#!/bin/bash\necho "$1|$2" >> "${avisos}"\n`, { mode: 0o755 });

  let pathEnv = "/usr/local/bin:/usr/bin:/bin";
  if (fusoFalso) {
    const shim = path.join(raiz, "shim");
    fs.mkdirSync(shim);
    fs.writeFileSync(path.join(shim, "timedatectl"), `#!/bin/bash\necho '${fusoFalso}'\n`, { mode: 0o755 });
    pathEnv = `${shim}:${pathEnv}`;
  }

  let saida = "";
  let codigo = 0;
  try {
    saida = execFileSync(VIGIA, [], {
      encoding: "utf8",
      env: {
        ...process.env,
        HWP_REPO: repo,
        HWP_VIGIA_STATE: state,
        HWP_VIGIA_GRACA: String(grace),
        HWP_AVISO: stub,
        PATH: pathEnv,
      },
    });
  } catch (e) {
    saida = String(e.stdout || "") + String(e.stderr || "");
    codigo = e.status ?? -1;
  }
  const disparados = fs.existsSync(avisos)
    ? fs.readFileSync(avisos, "utf8").split("\n").filter(Boolean)
    : [];
  console.log(`\n${nome}`);
  return { saida, codigo, disparados, state, raiz };
}

const repoLimpo = fixtureRepo(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hwp-fix-")), "work"), 0);
const repoAtras = fixtureRepo(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hwp-fix-")), "work"), 2);

/* 1 — rodada servida e empurrada: vigia verde e mudo. */
{
  const c = cenario("1. rodada do horário servida e empurrada → nenhum aviso", {
    turnoLog: cabeçalho(20),
    repo: repoLimpo,
  });
  confere("saiu 0", c.codigo === 0, `código ${c.codigo}`);
  confere("nenhum aviso disparado", c.disparados.length === 0, JSON.stringify(c.disparados));
  confere("diz que serviu", /servida e empurrada/.test(c.saida), c.saida.trim());
}

/* 2 — rodada perdida: o log não tem a rodada do horário. */
{
  const c = cenario("2. rodada perdida → um aviso, com a hora do slot", {
    turnoLog: "",
    repo: repoLimpo,
  });
  confere("saiu 0 (o vigia não é a rodada: ele avisa e sai)", c.codigo === 0, `código ${c.codigo}`);
  confere("exatamente um aviso", c.disparados.length === 1, JSON.stringify(c.disparados));
  confere("o aviso fala de rodada perdida", /não aparece em turno\.log/.test(c.disparados[0] || ""), c.disparados[0]);
  confere("a origem é 'rodada perdida'", (c.disparados[0] || "").startsWith("rodada perdida|"), c.disparados[0]);
  confere("gravou a chave de dedupe", fs.existsSync(path.join(c.state, "vigia-ultimo")), "sem vigia-ultimo");
}

/* 3 — repetir não spam: a mesma rodada perdida não vira dois avisos por hora. */
{
  const primeira = cenario("3a. primeira olhada da rodada perdida (prepara a chave)", {
    turnoLog: "",
    repo: repoLimpo,
  });
  const chave = fs.readFileSync(path.join(primeira.state, "vigia-ultimo"), "utf8").trim();
  const c = cenario(`3b. mesma rodada, segunda olhada (chave "${chave}") → zero aviso novo`, {
    turnoLog: "",
    repo: repoLimpo,
    chavePronta: chave,
  });
  confere("a primeira olhada avisou", primeira.disparados.length === 1, JSON.stringify(primeira.disparados));
  confere("nenhum aviso disparado na segunda", c.disparados.length === 0, JSON.stringify(c.disparados));
  confere("diz que já avisou", /já avisado/.test(c.saida), c.saida.trim());
}

/* 4 — a rodada rodou mas o push não chegou: o site no ar não vê a peça. */
{
  const c = cenario("4. rodada servida com commit local à frente do origin → aviso de push", {
    turnoLog: cabeçalho(20),
    repo: repoAtras,
  });
  confere("exatamente um aviso", c.disparados.length === 1, JSON.stringify(c.disparados));
  confere("o aviso conta os commits pendentes", /push não chegou.*2 commit/.test(c.disparados[0] || ""), c.disparados[0]);
}

/* 5 — fuso da máquina ≠ fuso da régua: os horários do timer não são os do check_hours. */
{
  const c = cenario("5. fuso divergente → aviso antes de qualquer conta", {
    turnoLog: cabeçalho(20),
    repo: repoLimpo,
    fusoFalso: "Europe/Lisbon",
  });
  confere("exatamente um aviso", c.disparados.length === 1, JSON.stringify(c.disparados));
  confere("nomeia os dois fusos", /Europe\/Lisbon/.test(c.disparados[0] || "") && /America\/Sao_Paulo/.test(c.disparados[0] || ""), c.disparados[0]);
}

/* 6 — folga: uma rodada que acabou de acontecer não é cobrada antes do prazo. */
{
  const c = cenario("6. slot vencido há menos da folga → nada a conferir", {
    turnoLog: "",
    repo: repoLimpo,
    grace: 60 * 24,
  });
  confere("nenhum aviso", c.disparados.length === 0, JSON.stringify(c.disparados));
  confere("diz que está na folga", /ainda está na folga/.test(c.saida), c.saida.trim());
}

/* 7 — invariante: o estado real desta máquina não foi tocado. */
{
  const real = path.join(os.homedir(), ".local", "state", "hwp");
  const tinhaChave = fs.existsSync(path.join(real, "vigia-ultimo"));
  confere("nenhum vigia-ultimo no estado real", !tinhaChave, "o teste escreveu em ~/.local/state/hwp");
  const logReal = fs.readFileSync(path.join(real, "turno.log"), "utf8");
  confere("o turno.log real continua com as rodadas dele", /turno local /.test(logReal), "sumiu");
  const avisosReal = fs.existsSync(path.join(real, "avisos.log")) ? fs.readFileSync(path.join(real, "avisos.log"), "utf8") : "";
  confere("nenhum aviso de teste no avisos.log real", !/rodada perdida/.test(avisosReal), avisosReal.split("\n").filter(Boolean).slice(-1)[0]);
}

console.log(`\n${verde} conferências verdes, ${falhas.length} vermelhas.`);
if (falhas.length) {
  for (const f of falhas) console.log(`  ✗ ${f}`);
  process.exit(1);
}
