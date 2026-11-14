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

/* Retrato do estado real ANTES da prova. A máquina é o relógio desde 13/11,
   então o vigia de verdade escreve `vigia-ultimo` e linhas em `avisos.log` —
   exigir que esses arquivos não existam seria o teste acusar o próprio sistema
   de estar funcionando. O que importa é que a prova não os mexa. */
const REAL = path.join(os.homedir(), ".local", "state", "hwp");
const CHAVE_REAL_ANTES = fs.existsSync(path.join(REAL, "vigia-ultimo")) ? fs.readFileSync(path.join(REAL, "vigia-ultimo"), "utf8") : null;
const AVISOS_REAIS_ANTES = fs.existsSync(path.join(REAL, "avisos.log")) ? fs.readFileSync(path.join(REAL, "avisos.log"), "utf8").split("\n").filter(Boolean).length : 0;

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

function cenario(nome, { turnoLog, repo, grace = 0, fusoFalso, chavePronta, agora }) {
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
        ...(agora ? { HWP_AGORA: String(agora) } : {}),
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
  confere("diz que é a folga da rodada, com o prazo em que ela vence", /folga da rodada.*vence às \d\d:\d\d/.test(c.saida), c.saida.trim());
}

/* 7 — a rodada rodou e morreu no portão: cabeçalho no log não é rodada servida.
       Medido em 13/11 às 20:23 — o vigia cantou "servida e empurrada" numa
       rodada VERMELHA, porque procurava o cabeçalho e não o desfecho. */
{
  const c = cenario("7. rodada do horário terminou VERMELHA → aviso com a causa, sem cantar verde", {
    turnoLog: cabeçalho(20) + "VERMELHO: a árvore tem mudanças não commitadas — a rodada parou antes de tocar em qualquer arquivo.\n",
    repo: repoLimpo,
  });
  confere("exatamente um aviso", c.disparados.length === 1, JSON.stringify(c.disparados));
  confere("o aviso diz que a rodada terminou vermelha", /terminou VERMELHA/.test(c.disparados[0] || ""), c.disparados[0]);
  confere("a causa escrita pelo runner vai no aviso", /mudanças não commitadas/.test(c.disparados[0] || ""), c.disparados[0]);
  confere("a etiqueta é 'rodada vermelha', não 'rodada perdida'", (c.disparados[0] || "").startsWith("rodada vermelha|"), c.disparados[0]);
  confere("não canta 'servida e empurrada'", !/servida e empurrada/.test(c.saida), c.saida.trim());
  confere("gravou a chave de dedupe", fs.existsSync(path.join(c.state, "vigia-ultimo")), "sem vigia-ultimo");
}

/* 7b — a rodada vermelha de ontem não mancha a verde de hoje: o bloco lido é o
        do cabeçalho do horário, não o arquivo inteiro. */
{
  const c = cenario("7b. VERMELHO de uma rodada anterior, cabeçalho de hoje verde → nenhum aviso", {
    turnoLog: cabeçalho(600) + "VERMELHO: causa antiga, de outro horário.\n" + cabeçalho(20) + "[fim] rodada completa.\n",
    repo: repoLimpo,
  });
  confere("nenhum aviso", c.disparados.length === 0, JSON.stringify(c.disparados));
  confere("canta verde desta vez", /servida e empurrada/.test(c.saida), c.saida.trim());
}

/* 8 — a virada do dia. Medido em 14/11 às 00:41: sem horário de hoje vencido, a
       conta antiga cobrava "ontem 08:23" (o PRIMEIRO de ontem), avisava uma
       rodada já cobrada e lia o bloco de outra. O slot vencido é o ÚLTIMO de
       ontem, e o relógio aqui é falsificado pela boca HWP_AGORA do próprio
       script — a única maneira de conferir a meia-noite sem esperar por ela. */
const AGORA_VIRADA = (() => { const d = new Date(); d.setHours(0, 41, 0, 0); return Math.floor(d.getTime() / 1000); })();
const ONTEM = new Date(AGORA_VIRADA * 1000 - 24 * 3600 * 1000);
function cabeçalhoEm(d) {
  return `===== turno local ${d.toISOString().replace(/\.\d+Z$/, "Z")} =====\n`;
}
const SLOT_ONTENDEIRO = (() => { const d = new Date(ONTEM); d.setHours(20, 23, 32, 0); return d; })();
{
  console.log("8. virada do dia: o slot vencido é o último de ontem (20:23), não o primeiro (08:23)");
  const c = cenario("8. 00:41, com a rodada das 20:23 de ontem verde no log", {
    turnoLog: cabeçalhoEm(SLOT_ONTENDEIRO) + "[fim] rodada completa.\n",
    repo: repoLimpo,
    agora: AGORA_VIRADA,
  });
  confere("nenhum aviso (a rodada de ontem serviu)", c.disparados.length === 0, JSON.stringify(c.disparados));
  confere("canta a hora certa, 20:23", /20:23/.test(c.saida), c.saida.trim());
  confere("não canta 08:23", !/08:23/.test(c.saida), c.saida.trim());
  confere("a data no aviso é a de ontem, uma vez só", !/20\d\d-.*20\d\d-/.test(c.saida), c.saida.trim());
}

/* 9 — na virada, sem rodada de ontem à noite: o aviso cobra 20:23 e a chave de
       dedupe é escrita com o slot certo, para não avisar duas vezes. */
{
  const primeiro = cenario("9a. 00:41, sem cabeçalho nenhum → cobra 20:23 de ontem", {
    turnoLog: "",
    repo: repoLimpo,
    agora: AGORA_VIRADA,
  });
  const chave = fs.readFileSync(path.join(primeiro.state, "vigia-ultimo"), "utf8").trim();
  const segundo = cenario("9b. mesma virada, segunda olhada → calado", {
    turnoLog: "",
    repo: repoLimpo,
    agora: AGORA_VIRADA,
    chavePronta: chave,
  });
  confere("um aviso, e ele cobra as 20:23", primeiro.disparados.length === 1 && /20:23/.test(primeiro.disparados[0]), JSON.stringify(primeiro.disparados));
  confere("a chave de dedupe é '<ontem> 20:23', sem data duplicada", /^\d{4}-\d\d-\d\d 20:23$/.test(chave), chave);
  confere("a segunda olhada não repete o aviso", segundo.disparados.length === 0 && /já avisado/.test(segundo.saida), `${JSON.stringify(segundo.disparados)} · ${segundo.saida.trim()}`);
}

/* 11 — a folga não é cega ao desfecho. Medido em 14/11 às 17:41: a rodada das
        16:23 tinha morrido no redator às 16:33 — o VERMELHO estava escrito no
        log havia 68 min — e o vigia cantou "ainda está na folga (-18 min para
        o horário)", adiando a causa até as 17:53 e ainda por cima com minutos
        negativos, que leem como defeito. A folga protege a rodada que PODE estar
        em curso; com cabeçalho do horário e fim vermelho provado no disco, ela
        não vale mais: o aviso sai na primeira olhada, com a mesma etiqueta e a
        mesma chave de dedupe de sempre. O cabeçalho do fixture usa o formato do
        runner (`date -u +%FT%TZ`), porque é exatamente esse grep que o vigia lê. */
/* O instante de referência do caso 11 é relativo ao AGORA real, nunca a um
   horário fixo: o vigia compara o relógio falsificado com o slot convertido no
   fuso DA MÁQUINA (`date -d "HOJE hh:mm"`), e num fuso a oeste de Greenwich
   (Los Angeles) qualquer hora da tarde UTC já passou de todos os check_hours
   locais — o slot cobrado deixaria de ser o do cabeçalho. Então: o último slot
   local já vencido antes do agora, mais 78 min (folga de 90 ainda correndo).
   Abaixo das 09:30 locais não há slot vencido hoje; usa-se o 20:23 de ontem,
   que é exatamente o que a virada do dia cobra (casos 8 e 9). */
const HORARIOS_11 = require(path.join(REPO, "pipeline", "cadence.json")).check_hours;
const AGORA_11 = Math.floor(Date.now() / 1000);
const DIA_BASE_HOJE = (() => {
  const d = new Date(AGORA_11 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();
const SLOT_E_ONTENDEIRO_11 = (() => {
  let u = null;
  for (const h of [...HORARIOS_11].sort()) {
    const d = new Date(`${DIA_BASE_HOJE}T${h}:00`); // hora wall-clock no fuso da máquina
    if (d.getTime() <= AGORA_11 * 1000) u = h;
  }
  if (u) return { slot: u, diaBase: DIA_BASE_HOJE };
  return { slot: [...HORARIOS_11].sort().pop(), diaBase: (() => { const d = new Date(AGORA_11 * 1000 - 86400 * 1000); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })() };
})();
const alvoRodada11 = Math.floor(new Date(`${SLOT_E_ONTENDEIRO_11.diaBase}T${SLOT_E_ONTENDEIRO_11.slot}:00`).getTime() / 1000);
const agoraSlot = alvoRodada11 + 78 * 60; // folga de 90 min ainda correndo
const p11 = (n) => String(n).padStart(2, "0");
const TS_RODADA = (() => {
  const d = new Date(alvoRodada11 * 1000 + 28 * 1000); // o timer abre em HH:MM:2x, medido no log vivo
  /* UTC de verdade, com getUTC* e não getters locais colados num "Z": o runner
     escreve `date -u +%FT%TZ` e o vigia faz `date -d` no cabeçalho, que só
     reconhece o Z. Medido nesta prova: com os campos locais dentro do sufixo
     "Z", o cabeçalho mentia o instante em três horas (16:23-03 virava 16:23Z),
     caía antes da janela ALVO−15min e o caso ficava mudo — o verde vinha de a
     folga engolir tudo, não do atalho. */
  return `${d.getUTCFullYear()}-${p11(d.getUTCMonth() + 1)}-${p11(d.getUTCDate())}T${p11(d.getUTCHours())}:${p11(d.getUTCMinutes())}:${p11(d.getUTCSeconds())}Z`;
})();
{
  console.log(`11. dentro da folga (slot ${SLOT_E_ONTENDEIRO_11.slot} de ${SLOT_E_ONTENDEIRO_11.diaBase}), rodada já encerrada VERMELHA no log → aviso imediato`);
  const c = cenario("11a. cabeçalho do slot + bloco encerrado no redator → causa agora, não quando a folga vencer", {
    turnoLog: `===== turno local ${TS_RODADA} =====\n[fim] o redator não entregou texto: qoder/Efficient: HTTP 500: timeout de 540s no CLI\nVERMELHO: o redator não entregou texto: qoder/Efficient: HTTP 500: timeout de 540s no CLI\ntools/turno.js terminou com código 1\nrodada vermelha: árvore recuada, só TURNO.md e pipeline/memory.json ficaram\npush ok — HEAD abc1234, origem 0\t0\n`,
    repo: repoLimpo,
    grace: 90,
    agora: agoraSlot,
  });
  confere("saiu 0 (o vigia avisa e sai)", c.codigo === 0, `código ${c.codigo}`);
  confere("exatamente um aviso, sem esperar a folga vencer", c.disparados.length === 1, JSON.stringify(c.disparados));
  confere("a etiqueta é 'rodada vermelha'", (c.disparados[0] || "").startsWith("rodada vermelha|"), c.disparados[0]);
  confere("o texto segue a convenção: rodou e terminou VERMELHA", /rodou e terminou VERMELHA:/.test(c.disparados[0] || ""), c.disparados[0]);
  confere("a causa do runner vai no aviso", /timeout de 540s no CLI/.test(c.disparados[0] || ""), c.disparados[0]);
  confere("não canta a espera da folga", !/nada a conferir|a folga da rodada/.test(c.saida), c.saida.trim());
  const chave = fs.existsSync(path.join(c.state, "vigia-ultimo")) ? fs.readFileSync(path.join(c.state, "vigia-ultimo"), "utf8").trim() : null;
  confere("a chave de dedupe escrita é '<dia-base> <slot>', formato de sempre", new RegExp(`^${SLOT_E_ONTENDEIRO_11.diaBase} ${SLOT_E_ONTENDEIRO_11.slot}$`).test(chave || ""), String(chave));
  const segunda = cenario("11b. mesma olhada, chave posta → calado (dedupe vale também na folga)", {
    turnoLog: `===== turno local ${TS_RODADA} =====\nVERMELHO: o redator não entregou texto: qoder/Efficient: HTTP 500: timeout de 540s no CLI\ntools/turno.js terminou com código 1\n`,
    repo: repoLimpo,
    grace: 90,
    agora: agoraSlot,
    chavePronta: chave || "",
  });
  confere("a segunda olhada não repete o aviso", segunda.disparados.length === 0 && /já avisado/.test(segunda.saida), `${JSON.stringify(segunda.disparados)} · ${segunda.saida.trim()}`);

  /* 12 — dentro da folga SEM fim provado, a folga continua valendo: cabeçalho
          escrito no começo é prova de que a rodada abriu, não de que serviu — e
          uma rodada em curso não pode virar "rodada vermelha" na metade. E a
          mensagem da folga não imprime número negativo jamais: quem lê precisa
          saber quando volta, não contar déficit. */
  const tsRodando = (() => {
    // O mesmo UTC de verdade do cabeçalho do caso 11: abrir há 4 min, no fuso real.
    const d = new Date(agoraSlot * 1000 - 4 * 60 * 1000);
    return `${d.getUTCFullYear()}-${p11(d.getUTCMonth() + 1)}-${p11(d.getUTCDate())}T${p11(d.getUTCHours())}:${p11(d.getUTCMinutes())}:${p11(d.getUTCSeconds())}Z`;
  })();
  const r12 = cenario("12a. cabeçalho do slot sem VERMELHO no bloco (rodada em curso) → silêncio", {
    turnoLog: `===== turno local ${tsRodando} =====\n[coleta] fila: 3 pautas\n[brief] pipeline/drafts/a-cosmic-magnifying-glass/ criado\n`,
    repo: repoLimpo,
    grace: 90,
    agora: agoraSlot,
  });
  console.log("12. dentro da folga sem fim provado → espera, e a mensagem declara o prazo");
  confere("nenhum aviso: a rodada ainda pode estar escrevendo", r12.disparados.length === 0, JSON.stringify(r12.disparados));
  confere("diz que é a folga da rodada", /folga da rodada/.test(r12.saida), r12.saida.trim());
  confere("declara o prazo em que a folga vence (slot + 90 min)", (() => {
    const m = r12.saida.match(/vence às (\d\d):(\d\d)/);
    if (!m) return false;
    const d = new Date((alvoRodada11 + 90 * 60) * 1000); // alvo + folga, no fuso da máquina
    return Number(m[1]) === d.getHours() && Number(m[2]) === d.getMinutes();
  })(), r12.saida.trim());
  confere("nenhum número negativo na mensagem", !/-\s?\d/.test(r12.saida), r12.saida.trim());
  confere("faltam minutos contados para cima, nunca zero quando falta", /faltam 12 min/.test(r12.saida), r12.saida.trim());
  confere("não escreveu chave de dedupe (nada foi avisado)", !fs.existsSync(path.join(r12.state, "vigia-ultimo")), "vigia-ultimo apareceu");

  const r12b = cenario("12b. log vazio dentro da folga → perdida só se cobra depois dela", {
    turnoLog: "",
    repo: repoLimpo,
    grace: 90,
    agora: agoraSlot,
  });
  confere("nenhum aviso com o log vazio na folga", r12b.disparados.length === 0, JSON.stringify(r12b.disparados));
  confere("a mensagem de folga continua sem negativo", /folga da rodada/.test(r12b.saida) && !/-\s?\d/.test(r12b.saida), r12b.saida.trim());

  /* 13 — mutação: sem o atalho novo, o mesmo log do caso 11 volta a cantar a
          folga e engole a causa por mais de uma hora. É a prova de que o caso 11
          mede a correção, não o acaso. */
  const copia = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hwp-muta-")), "hwp-vigia-sem-atalho.sh");
  const fonte = fs.readFileSync(VIGIA, "utf8");
  console.log("13. mutação: mesmo log, atalho removido → a folga engole a causa outra vez");
  if (!fonte.includes('FIM_VERMELHO="$CAUSA_LINHA"')) {
    confere("o atalho existe no script para poder ser mutado", false, fonte.slice(0, 200));
  } else {
    fs.writeFileSync(copia, fonte.replace('FIM_VERMELHO="$CAUSA_LINHA"', 'FIM_VERMELHO=""'), { mode: 0o755 });
    let saida = "";
    try {
      saida = execFileSync(copia, [], {
        encoding: "utf8",
        env: {
          ...process.env,
          HWP_REPO: repoLimpo,
          HWP_VIGIA_STATE: fs.mkdtempSync(path.join(os.tmpdir(), "hwp-muta-state-")),
          HWP_VIGIA_GRACA: "90",
          HWP_AVISO: path.join(os.tmpdir(), "stub-inexistente.sh"),
          HWP_AGORA: String(agoraSlot),
        },
      });
    } catch (e) {
      saida = String(e.stdout || "") + String(e.stderr || "");
    }
    confere("sem o atalho, a folga engole a causa outra vez", /folga da rodada/.test(saida), saida.trim());
  }
}

/* 14 — invariante: o estado real desta máquina não foi tocado. */
{
  console.log("14. o estado real da máquina não foi tocado pela prova");
  const real = path.join(os.homedir(), ".local", "state", "hwp");
  const chaveAgora = fs.existsSync(path.join(real, "vigia-ultimo")) ? fs.readFileSync(path.join(real, "vigia-ultimo"), "utf8") : null;
  confere("a prova não escreveu na chave de dedupe real", chaveAgora === CHAVE_REAL_ANTES, `${CHAVE_REAL_ANTES} → ${chaveAgora}`);
  const logReal = fs.readFileSync(path.join(real, "turno.log"), "utf8");
  confere("o turno.log real continua com as rodadas dele", /turno local /.test(logReal), "sumiu");
  const agora = fs.existsSync(path.join(real, "avisos.log")) ? fs.readFileSync(path.join(real, "avisos.log"), "utf8").split("\n").filter(Boolean) : [];
  confere("o avisos.log real não ganhou linha", agora.length === AVISOS_REAIS_ANTES, `${AVISOS_REAIS_ANTES} → ${agora.length}`);
  confere("nenhuma linha nova é de fixture", !agora.slice(AVISOS_REAIS_ANTES).some((l) => /fixture|prova|baseline/.test(l)), agora.slice(AVISOS_REAIS_ANTES).join(" · "));
}

console.log(`\n${verde} conferências verdes, ${falhas.length} vermelhas.`);
if (falhas.length) {
  for (const f of falhas) console.log(`  ✗ ${f}`);
  process.exit(1);
}
