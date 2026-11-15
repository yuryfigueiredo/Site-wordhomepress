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

   A grade de horários NÃO é literal nesta prova — ela vem de
   pipeline/cadence.json (check_hours), porque a régua mora no JSON e a prova
   tem de continuar valendo quando o dono a recalibra. Medido em 14/11: a
   agenda passou de quatro horários (08:23/12:23/16:23/20:23) para seis de 4h
   (02:23 … 22:23) e os casos que hard-codificavam "o último de ontem é 20:23"
   passaram a cobrar uma hora que o vigia, lendo o JSON certo, já não cobra —
   o verde mentiria na mesma proporção. O que se fixa aqui é a invariante:
   na virada do dia o slot cobrado é o ÚLTIMO da grade de ontem, nunca o
   primeiro. Os instantes dos casos falsificados (8, 9, 11, 12, 13) são
   derivados dos horários lidos, no fuso da máquina, via `date -d` — a mesma
   boca que o vigia usa, nunca um horário fixo: a prova de virada roda em dois
   momentos (as 00:41, ainda na folga do último slot de ontem, e uma hora depois
   do primeiro horário de hoje, com a folga já vencida), porque com seis
   horários de 4h existe uma janela da manhã em que "hoje" já tem slot vencido
   e a conta errada passaria verde numa olhada só.

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

/* A grade lida do JSON, não copiada aqui — é a mesma boca que o vigia usa. */
const REGUA = require(path.join(REPO, "pipeline", "cadence.json"));
const HORARIOS = REGUA.check_hours;
const ULTIMO_HORARIO = [...HORARIOS].sort().pop();
const PRIMEIRO_HORARIO = [...HORARIOS].sort()[0];
const pad2 = (n) => String(n).padStart(2, "0");
const diaLocal = (epoch) => {
  const d = new Date(epoch * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
/* O instante do slot hh:mm num dia wall-clock DA MÁQUINA, medido com o mesmo
   `date -d` que o vigia usa (nunca Date.parse, que interpretaria como UTC). */
function instanteSlot(dia, hhmm, segundos = 0) {
  const out = execFileSync("date", ["-d", `${dia} ${hhmm}`, "+%s"], { encoding: "utf8" }).trim();
  const n = Number(out);
  if (!Number.isFinite(n)) throw new Error(`date -d falhou para "${dia} ${hhmm}"`);
  return n + segundos;
}

/* O relógio falsificado dos casos de virada (8 e 9): os dois momentos em que a
   meia-noite tem consequência. Às 00:41 a folga do último horário de ontem
   ainda corre, então o vigia está calado por causa própria; uma hora depois do
   primeiro horário de hoje a folga já venceu E as 00:41 ficaram para trás — é
   aí que se vê qual dia ele cobre. Medido nesta prova: com o fixture herdando
   a agenda real inteira, essa segunda olhada cobra "hoje 02:23" e três
   conferências caem; com a grade fixa, o caso continua verde seja a que hora
   o dono rodar a prova. */
function viradas() {
  const agora = Math.floor(Date.now() / 1000);
  const alvos = [];
  for (let d = 0; d < 3; d++) {
    const dia = diaLocal(agora - d * 86400);
    alvos.push(instanteSlot(dia, "00:41"));
    alvos.push(instanteSlot(dia, PRIMEIRO_HORARIO, 60 * 60));
  }
  return alvos.filter((t) => t <= agora).sort((a, b) => a - b).slice(-2);
}
const VIRADAS = viradas();

/* Um repo mínimo com pipeline/cadence.json, um commit empurrado e (opcional)
   um commit local que o origin nunca viu — é o retrato do push que falhou.
   O cadence do fixture vem por parâmetro porque os casos de virada (8 e 9)
   precisam de uma grade própria: falsificar só o relógio sem fixar a grade
   deixa o caso dependente da hora em que a prova roda — medido às 21:01 de
   14/11, com a agenda nova de 4h o último slot vencido às 00:41 falsificadas
   era o 22:23 DE HOJE (02:23 já tinha passado), não o de ontem, e o caso
   cobrava a si mesmo. A grade do fixture é a régua real menos o primeiro
   horário: o único slot vencido antes das 00:41 é sempre o último de ontem,
   e a invariante conferida continua sendo a do vigia sobre o JSON dele. */
function fixtureRepo(dir, commitsLocais, cadencePath) {
  fs.mkdirSync(path.join(dir, "pipeline"), { recursive: true });
  fs.copyFileSync(cadencePath || path.join(REPO, "pipeline", "cadence.json"), path.join(dir, "pipeline", "cadence.json"));
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

/* Repo dos casos de virada: a grade real sem o primeiro horário, para que às
   00:41 falsificadas exista exatamente um slot vencido — o último de ontem. */
const repoVirada = (() => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hwp-fix-virada-")), "work");
  const fonte = path.join(dir, "pipeline", "cadence.json");
  fs.mkdirSync(path.dirname(fonte), { recursive: true });
  fs.writeFileSync(fonte, JSON.stringify({ ...REGUA, check_hours: HORARIOS.slice(1) }, null, 2) + "\n");
  return fixtureRepo(dir, 0, fonte);
})();

/* Idem, com dois commits locais que o origin nunca viu — é a boca do caso 8b:
   o vigia tem de reconhecer a rodada de ontem E cobrar o push que não chegou. */
const repoViradaAtras = (() => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hwp-fix-virada-atras-")), "work");
  const fonte = path.join(dir, "pipeline", "cadence.json");
  fs.mkdirSync(path.dirname(fonte), { recursive: true });
  fs.writeFileSync(fonte, JSON.stringify({ ...REGUA, check_hours: HORARIOS.slice(1) }, null, 2) + "\n");
  return fixtureRepo(dir, 2, fonte);
})();

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

/* 7c — o caso medido em 14/11 às 20:41, quando o repo ainda estava na grade de
        quatro horários (08:23/12:23/16:23/20:23): a rodada das 18:23 publicou a
        supernova e fechou com código 0, e o vigia cantou "a rodada das 16:23 não
        aparece em turno.log" — cobrava um horário que a agenda nova já não tem,
        porque a conta do slot vencido foi feita contra uma grade antiga. A
        régua mora no JSON, então o fixture planta o cabeçalho do ÚLTIMO slot
        vencido da grade lida (agora 18:23) e exige que o vigia cubra esse, sem
        mencionar nenhum dos horários que já saíram da agenda. */
{
  const agoraCaso = Math.floor(Date.now() / 1000);
  const diaCaso = diaLocal(agoraCaso);
  const vencidos = HORARIOS.filter((h) => instanteSlot(diaCaso, h) <= agoraCaso);
  const slotCobrado = vencidos.length ? [...vencidos].sort().pop() : ULTIMO_HORARIO;
  const diaBase = vencidos.length ? diaCaso : diaLocal(agoraCaso - 86400);
  const tsCabecalho = execFileSync("date", ["-u", "-d", `@${instanteSlot(diaBase, slotCobrado, 25)}`, "+%Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" }).trim();
  const c = cenario(`7c. rodada do horário cobrado (${slotCobrado}) publicada e verde → verde, e na hora certa`, {
    turnoLog: `===== turno local ${tsCabecalho} =====\n[publicação] a-gravitational-lens-supernova-reappearance-time-delay no ar\n[fim] rodada completa.\n`,
    repo: repoLimpo,
  });
  confere("nenhum aviso para a rodada que entregou peça", c.disparados.length === 0, JSON.stringify(c.disparados));
  confere("canta 'servida e empurrada'", /servida e empurrada/.test(c.saida), c.saida.trim());
  confere(`cobre o horário da grade lida (${slotCobrado}), não um slot fora de moda`, new RegExp(`das ${slotCobrado}`).test(c.saida), c.saida.trim());
  for (const abandonado of ["08:23", "12:23", "16:23", "20:23"]) {
    if (abandonado === slotCobrado) continue;
    confere(`não cobra o horário ${abandonado}, que saiu da agenda em 14/11`, !new RegExp(abandonado).test(c.saida), c.saida.trim());
  }
}

/* 8 e 9 — a virada do dia, conferida nos dois instantes de VIRADAS. Medido em
           14/11 às 00:41: sem horário de hoje vencido, a conta antiga cobrava
           "ontem 08:23" (o PRIMEIRO da grade), avisava uma rodada já cobrada e
           lia o bloco de outra. O slot vencido é o ÚLTIMO de ontem, e o relógio
           aqui é falsificado pela boca HWP_AGORA do próprio script — a única
           maneira de conferir a meia-noite sem esperar por ela. Os horários
           vêm do JSON do fixture (ver repoVirada), não de literal, e o
           cabeçalho verde do caso 8 é montado pelo MESMO `date -d` que o vigia
           usa: as duas pontas da conta saem de bocas diferentes (o JS calcula
           o instante, o bash do vigia o reconstrói a partir do "Z" no log). */
const SLOT_ONTENDEIRO_HHMM = ULTIMO_HORARIO;
for (const AGORA_VIRADA of VIRADAS) {
  const rotulo = execFileSync("date", ["-d", `@${AGORA_VIRADA}`, "+%H:%M"], { encoding: "utf8" }).trim();
  const DIA_ONTENDEIRO = diaLocal(AGORA_VIRADA - 86400);
  /* O cabeçalho do fixture é UTC de verdade, no formato que o runner escreve
     (`date -u +%FT%TZ`), e o instante vem do mesmo `date -d` que o vigia usa
     para achar o slot: as duas pontas da conta saem de bocas diferentes. Com
     getters locais colados num "Z" o cabeçalho mentia três horas, caía fora da
     janela ALVO−15min e o caso dava verde por inércia — a folga engolindo tudo
     — e não pelo desfecho. Medido nesta prova quando o caso era um instante só. */
  const TS_CABECALHO = execFileSync("date", ["-u", "-d", `@${instanteSlot(DIA_ONTENDEIRO, SLOT_ONTENDEIRO_HHMM, 32)}`, "+%Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" }).trim();
  const turnoLog = `===== turno local ${TS_CABECALHO} =====\n[fim] rodada completa.\n`;
  console.log(`8. virada (${rotulo}): o slot vencido é o último de ontem (${SLOT_ONTENDEIRO_HHMM}), não o primeiro (${PRIMEIRO_HORARIO})`);
  const c = cenario(`8. ${rotulo}, com a rodada das ${SLOT_ONTENDEIRO_HHMM} de ontem verde no log`, {
    turnoLog,
    repo: repoVirada,
    agora: AGORA_VIRADA,
  });
  confere(`[${rotulo}] nenhum aviso (a rodada de ontem serviu)`, c.disparados.length === 0, JSON.stringify(c.disparados));
  confere(`[${rotulo}] canta a hora certa, ${SLOT_ONTENDEIRO_HHMM}`, new RegExp(SLOT_ONTENDEIRO_HHMM).test(c.saida), c.saida.trim());
  confere(`[${rotulo}] não canta ${PRIMEIRO_HORARIO} de hoje`, !new RegExp(`${PRIMEIRO_HORARIO} \\(${diaLocal(AGORA_VIRADA)}\\)`).test(c.saida), c.saida.trim());
  confere(`[${rotulo}] o cabeçalho lido é o instante do slot de ontem, em UTC`, /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ/.test(TS_CABECALHO) && Number(execFileSync("date", ["-d", TS_CABECALHO, "+%s"], { encoding: "utf8" })) === instanteSlot(DIA_ONTENDEIRO, SLOT_ONTENDEIRO_HHMM, 32), `${TS_CABECALHO} · ${c.saida.trim()}`);
  /* O verde tem de vir do desfecho do bloco, não da folga engolindo tudo.
     Sem esta, um cabeçalho que mentisse o instante (getters locais colados num
     "Z") continuava verde: o caso passava a cobrar OUTRO slot, sem cabeçalho
     nenhum ali e, com o relógio ainda dentro da folga daquele, calava por
     causa própria — medido nesta prova quando o caso era um instante só. */
  confere(`[${rotulo}] canta 'servida e empurrada', não a espera da folga`, /servida e empurrada/.test(c.saida) && !/folga da rodada/.test(c.saida), c.saida.trim());
  confere(`[${rotulo}] a data no aviso é a de ontem, uma vez só`, !/20\d\d-.*20\d\d-/.test(c.saida), c.saida.trim());

  /* 8b — o mesmo cabeçalho verde, agora sem o empurrão: o HEAD do fixture está
          à frente do origin. É a boca que prova que a conferência de cima veio
          do bloco lido: se o vigia estivesse calado só por causa da folga, este
          caso continuaria mudo e o verde de 8 não diria nada sobre desfecho. */
  const c8b = cenario(`8b. ${rotulo}, rodada das ${SLOT_ONTENDEIRO_HHMM} de ontem verde mas com push pendente → aviso de push`, {
    turnoLog,
    repo: repoViradaAtras,
    agora: AGORA_VIRADA,
  });
  /* A boca do empurrão não nomeia o slot (é a mensagem de push, fixa), então a
     prova de que ele caiu no dia certo é a chave de dedupe escrita acima. */
  confere(`[${rotulo}] o push pendente é cobrado depois de a rodada ser reconhecida`, c8b.disparados.length === 1 && /push não chegou/.test(c8b.disparados[0] || ""), `${JSON.stringify(c8b.disparados)} · ${c8b.saida.trim()}`);
  confere(`[${rotulo}] a chave de dedupe escrita é a do slot de ontem`, (() => {
    const k = path.join(c8b.state, "vigia-ultimo");
    return fs.existsSync(k) && fs.readFileSync(k, "utf8").trim() === `${DIA_ONTENDEIRO} ${SLOT_ONTENDEIRO_HHMM}`;
  })(), "sem chave do slot certo");

  /* 9 — na mesma virada, sem rodada de ontem à noite: o aviso cobra o último
         slot da grade de ontem e a chave de dedupe é escrita com esse slot. */
  const primeiro = cenario(`9a. ${rotulo}, sem cabeçalho nenhum → cobra ${SLOT_ONTENDEIRO_HHMM} de ontem`, {
    turnoLog: "",
    repo: repoVirada,
    agora: AGORA_VIRADA,
  });
  const chave = fs.readFileSync(path.join(primeiro.state, "vigia-ultimo"), "utf8").trim();
  const segundo = cenario(`9b. ${rotulo}, segunda olhada → calado`, {
    turnoLog: "",
    repo: repoVirada,
    agora: AGORA_VIRADA,
    chavePronta: chave,
  });
  confere(`[${rotulo}] um aviso, e ele cobra as ${SLOT_ONTENDEIRO_HHMM}`, primeiro.disparados.length === 1 && new RegExp(SLOT_ONTENDEIRO_HHMM).test(primeiro.disparados[0]), JSON.stringify(primeiro.disparados));
  confere(`[${rotulo}] a chave de dedupe é '<${DIA_ONTENDEIRO}> ${SLOT_ONTENDEIRO_HHMM}', sem data duplicada`, chave === `${DIA_ONTENDEIRO} ${SLOT_ONTENDEIRO_HHMM}`, chave);
  confere(`[${rotulo}] a segunda olhada não repete o aviso`, segundo.disparados.length === 0 && /já avisado/.test(segundo.saida), `${JSON.stringify(segundo.disparados)} · ${segundo.saida.trim()}`);
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
   Antes do primeiro horário de hoje não há slot vencido; usa-se o ÚLTIMO de
   ontem, que é exatamente o que a virada do dia cobra (casos 8 e 9). */
const AGORA_11 = Math.floor(Date.now() / 1000);
const DIA_BASE_HOJE = diaLocal(AGORA_11);
const SLOT_E_ONTENDEIRO_11 = (() => {
  let u = null;
  for (const h of [...HORARIOS].sort()) {
    if (instanteSlot(DIA_BASE_HOJE, h) <= AGORA_11 * 1000) u = h;
  }
  if (u) return { slot: u, diaBase: DIA_BASE_HOJE };
  return { slot: ULTIMO_HORARIO, diaBase: diaLocal(AGORA_11 - 86400) };
})();
const alvoRodada11 = instanteSlot(SLOT_E_ONTENDEIRO_11.diaBase, SLOT_E_ONTENDEIRO_11.slot);
const agoraSlot = alvoRodada11 + 78 * 60; // folga de 90 min ainda correndo
const TS_RODADA = (() => {
  const d = new Date(alvoRodada11 * 1000 + 28 * 1000); // o timer abre em HH:MM:2x, medido no log vivo
  /* UTC de verdade, com getUTC* e não getters locais colados num "Z": o runner
     escreve `date -u +%FT%TZ` e o vigia faz `date -d` no cabeçalho, que só
     reconhece o Z. Medido nesta prova: com os campos locais dentro do sufixo
     "Z", o cabeçalho mentia o instante em três horas (16:23-03 virava 16:23Z),
     caía antes da janela ALVO−15min e o caso ficava mudo — o verde vinha de a
     folga engolir tudo, não do atalho. */
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}Z`;
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
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}Z`;
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

/* 14 — invariante: a régua desta máquina e o estado real dela. */
{
  console.log("14. a grade lida pela prova é a do repo, e o estado real não foi tocado");
  /* A prova lê a agenda do mesmo JSON que o vigia e que o doctor conferem; se
     ela passasse a carregar uma grade própria (hard-code ou fixture solto),
     verde aqui deixaria de dizer nada sobre a agenda em produção. Medido
     nesta passada: com o fixture herdando a grade inteira, cinco conferências
     da virada caem; contra um vigia mutado para cobrar o PRIMEIRO slot vencido,
     caem as da folga e a do formato da chave. */
  confere("a régua lida tem seis horários de 4h, como o cadence.json de 14/11", HORARIOS.length === 6 && REGUA.check_hours.join(",") === "02:23,06:23,10:23,14:23,18:23,22:23", `${HORARIOS.join(",")} · ${REGUA.check_hours.join(",")}`);
  const nodeBin = process.env.HWP_NODE || "/usr/local/bin/node";
  const gradeDoRepo = (dir) => execFileSync(nodeBin, ["-e", "console.log(require('./pipeline/cadence.json').check_hours.join(','))"], { cwd: dir, encoding: "utf8" }).trim();
  const gradeVigia = gradeDoRepo(repoLimpo);
  confere("a grade da prova é a grade do repo, na ordem do JSON", gradeVigia === REGUA.check_hours.join(","), `${gradeVigia} ≠ ${REGUA.check_hours.join(",")}`);
  confere("o fixture de virada tem a grade fixada sem o primeiro horário — senão a olhada da manhã cobra hoje", HORARIOS.length > 1 && gradeDoRepo(repoVirada) === HORARIOS.slice(1).join(","), `${gradeDoRepo(repoVirada)} · ${HORARIOS.join(",")}`);
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
