/* teste-roda-dupla.js — prova de que a SEGUNDA mão no mesmo horário de agenda
   não custa pauta, não custa redator e não custa a capa da primeira.

   O defeito é de preço, não de cor. Até 14/11 havia um relógio só e o `flock -n`
   do runner bastava: ele serializa SOBREPOSIÇÃO. Com a automação agendada do app
   disparando o mesmo hwp-turno.sh nos mesmos horários do check_hours, aparece a
   invocação que acorda 45 min depois da primeira, ainda dentro do MESMO horário:
   o lock já está livre, a rodada inteira roda, e o resultado é caro e inútil —
   capa não gira (cover-state registra uma troca por `rodadaId()`), nada publica
   (`min_hours_between_publishes` é o espaçamento dos horários), mas o passo 5
   marca a pauta como `em_andamento` (6h fora da fila) e o redator gasta ~13 min
   do plano do dono. É a mesma conta do `pick-lead.js --dry` (duas olhadas, duas
   pautas queimadas, medido 14/11), cobrada agora do próprio relógio.

   Este arquivo roda o VERDADEIRO `tools/turno.js` dentro de cópias do repo em
   /tmp. A única etapa substituída é `write.js`, o redator do app — o que se
   confere é justamente o preço dele: na boca verde ele grava um rastro falso em
   pipeline/memory.json, então "a segunda mão não escreveu nada" quer dizer
   "não queimou pauta nenhuma E não chamou o redator". Todo o resto é o repo
   real: ingest, build, doctor, pick-lead, new-post, find-cover, check-post,
   score e publish de verdade. A falsificação arranca a chamada do portão e exige
   que a segunda mão volte a pagar o preço; sem ela, toda asserção de exit code é
   vazia.                                                                          */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const fixtures = [];
let verde = 0;
const falhas = [];
function confere(nome, ok, dado) {
  if (ok) {
    verde++;
    console.log(`  ✓ ${nome}`);
  } else {
    falhas.push(nome);
    console.log(`  ✗ ${nome}${dado === undefined ? "" : " :: " + String(dado).slice(0, 400)}`);
  }
}

/* Estado do repo REAL antes de qualquer cópia — a invariante do fim. */
const turnAntes = fs.readFileSync(path.join(ROOT, "TURNO.md"), "utf8");
const memAntes = fs.readFileSync(path.join(ROOT, "pipeline", "memory.json"), "utf8");
const coverAntes = fs.readFileSync(path.join(ROOT, "pipeline", "state", "cover-state.json"), "utf8");
const lockReal = path.join(ROOT, "pipeline", "state", "round-lock.json");
const lockAntes = fs.existsSync(lockReal) ? fs.readFileSync(lockReal, "utf8") : null;

const roundLock = require(path.join(ROOT, "tools", "lib", "round-lock.js"));
const coverState = require(path.join(ROOT, "tools", "lib", "cover-state.js"));
const SLOT = roundLock.chave();

/* O balde de ontem existe na agenda? Se a máquina acordar entre 00:00 e a
   primeira rodada, `rodadaId()` devolve o ÚLTIMO horário de ONTEM — plantar
   "ontem" seria então plantar hoje. Nesse caso desloca-se a conferência para o
   primeiro horário de amanhã, resolvido pela MESMA função do repo (o
   `horariosDasRodadas` do cover-state), nunca por conta paralela. */
const OUTRO = (() => {
  const horarios = coverState.horariosDasRodadas();
  if (!horarios.length) return `${SLOT.slice(0, 10)}T23:59`;
  const alvo = Number(SLOT.slice(11, 13)) * 60 + Number(SLOT.slice(14, 16));
  const proximo = horarios.find((m) => m > alvo);
  /* Dentro do dia: o próximo horário ainda HOJE. Depois do último: o primeiro de
     amanhã. Antes do primeiro: `rodadaId()` está em ontem, então o outro balde é
     o primeiro de hoje. */
  const d = new Date();
  let instante;
  if (proximo !== undefined) instante = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(proximo / 60), proximo % 60, 30);
  else if (alvo >= horarios[0]) {
    const m = horarios[0];
    instante = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, Math.floor(m / 60), m % 60, 30);
  } else {
    const m = horarios[0];
    instante = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(m / 60), m % 60, 30);
  }
  const id = roundLock.chave(instante);
  return id === SLOT ? `${SLOT.slice(0, 10)}T23:59` : id;
})();

/* ───────────────────────── fixture ───────────────────────── */

/* A fixture é o repo inteiro MENOS a agenda de hoje. O travão do passo 4 é lido
   de duas fontes (lib/cadence.js): `publishes` de pipeline/memory.json e os
   commits "publish:" do dia UTC no git log. Com uma peça publicada há duas
   horas, toda rodada da prova morreria em "cadência: intervalo mínimo" antes de
   chegar ao redator, e nenhuma asserção de "queimou pauta / não queimou pauta"
   mediria coisa nenhuma. Recorte de AGENDA, não de conteúdo: catálogo, notas,
   fila, capa, voz e o pick-lead real continuam os do repo.

   O histórico local vira um commit raso SEM PAI com a árvore da fixture: sem
   rebase, sem tocar no repo real, e a conta do teto lê zero publicações hoje.
   Os assuntos do histórico vão para o corpo da mensagem — só a data de autoria
   vai para ontem, que é exatamente o que a régua de dia UTC cobra.

   Duas coisas medidas ao montar esta prova, ambas necessárias:
   1) `git init` dentro de uma cópia NÃO apaga ref nenhum — ele reencontra
      `.git/refs/heads/main` apontando no HEAD herdado e o "commit novo" sai com
      pai, encadeado nos 180 commits reais, com as publicações de hoje vivas no
      `git log --since`. Por isso a cabeça é movida para um branch unborn
      (`symbolic-ref`) ANTES do commit: aí o objeto nasce sem pai de verdade.
   2) `git commit --date` só move a data de AUTORIA; a de COMMIT fica em agora.
      E quem conta publicações usa a de commit quando o `--since` entra em jogo.
      Então as duas datas vão pelos meios de sempre, `GIT_AUTHOR_DATE` e
      `GIT_COMMITTER_DATE`.                                                   */
function destravaAgenda(dir) {
  const git = (args, env) =>
    execFileSync("git", args, { cwd: dir, stdio: "ignore", env: { ...process.env, ...(env || {}) } });
  const memP = path.join(dir, "pipeline", "memory.json");
  const mem = JSON.parse(fs.readFileSync(memP, "utf8"));
  mem.publishes = [];
  fs.writeFileSync(memP, JSON.stringify(mem, null, 2) + "\n");
  for (const f of ["ORIG_HEAD", "MERGE_HEAD", "rebase-apply", "rebase-merge", "CHERRY_PICK_HEAD"])
    fs.rmSync(path.join(dir, ".git", f), { recursive: true, force: true });
  let assuntos = [];
  try {
    assuntos = execFileSync("git", ["log", "--pretty=%s"], { cwd: dir, stdio: "pipe" }).toString().split("\n").filter(Boolean).slice(0, 60);
  } catch {}
  git(["init", "-q"]);
  git(["config", "user.name", "fixture"]);
  git(["config", "user.email", "fixture@example.invalid"]);
  git(["symbolic-ref", "HEAD", "refs/heads/fixture-rasa"]);
  git(["add", "-A"]);
  const ontem = new Date(Date.now() - 86400000).toISOString().replace("T", "T").slice(0, 10) + "T18:00:00Z";
  git(["commit", "-q", "-m", `${assuntos[0] || "fixture"}\n\n${assuntos.slice(1).join("\n")}`], {
    GIT_AUTHOR_DATE: ontem,
    GIT_COMMITTER_DATE: ontem,
  });
  /* A travessa da prova inteira, conferida aqui e não presumida: se a agenda da
     fixture não estiver livre, as asserções de preço de rodada ("queimou pauta",
     "chamou o redator") morrem no passo 4 e passam verdes pela razão errada. */
  const cadence = require(path.join(ROOT, "tools", "lib", "cadence.js"));
  const hoje = cadence.publishedToday(dir);
  const gap = cadence.horasDesdeUltimaPublicacao(dir);
  const min = Number(JSON.parse(fs.readFileSync(path.join(dir, "pipeline", "cadence.json"), "utf8")).min_hours_between_publishes);
  confere("00.a agenda da fixture está destravada (0 publicações hoje)", hoje === 0, `lido: ${hoje}`);
  confere("00.b o intervalo mínimo não trava a fixture", gap === null || gap >= min, `gap: ${gap === null ? "sem publicação" : gap.toFixed(2) + "h"} / mín ${min}h`);
  return dir;
}

function copia() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwp-rodadupla-"));
  fixtures.push(dir);
  /* o "/." é o que copia o CONTEÚDO: sem ele o cp leva a pasta para dentro da
     fixture e tools/turno.js não existe no caminho que a fixture lê. */
  execFileSync("cp", ["-a", `${ROOT}/.`, `${dir}/`], { stdio: "ignore" });
  /* O resíduo que a própria prova evita: um `cp -a` do repo leva QUALQUER cópia
     acidental da árvore junto, e cada .html dela vira página para o doctor —
     uma delas (null/404.html, medido nesta máquina em 14/11) não tem og:image e
     derruba a manutenção antes de a rodada começar. A fixture limpa esse lixo
     por nome, sem apagar nada do repo real. */
  for (const sobra of ["null"]) if (fs.existsSync(path.join(dir, sobra))) fs.rmSync(path.join(dir, sobra), { recursive: true, force: true });
  return dir;
}

/* write.js é a única etapa trocada. Verde: grava o rastro do redator de verdade
   — `em_andamento` na URL que o passo 5 acabou de comprometer, no instante em
   que o texto sai — e escreve um draft mínimo fora do diretório de rascunhos da
   rodada. Vermelho (opcional): morre com timeout, como nas rodadas das 14:44 e
   16:23 de 14/11.

   O stub NÃO pode escrever `pipeline/drafts/<slug>/draft.json`: o pick-lead
   descarta candidata cujo slug bate com um diretório de rascunho, então gravar
   ali mataria a pauta da rodada SEGUINTE da fixture e "a segunda mão não queimou
   nada" seria provado pelo rastro errado. Com o draft no caminho alternativo, o
   check-post reprova na terceira tentativa e a rodada fecha verde por falta de
   matéria — o mesmo desfecho das rodadas reais sem texto aprovável, com a pauta
   marcada e nenhuma publicação. */
const RASTRO = `const fs=require("fs"),path=require("path");
const slug=process.argv[2];
const dir=path.join(__dirname,"..","pipeline","drafts",slug);
const br=JSON.parse(fs.readFileSync(path.join(dir,"brief.json"),"utf8"));
const url=(br.meta&&br.meta.lead_url)||br.sources[0].url;
const memPath=path.join(__dirname,"..","pipeline","memory.json");
const mem=JSON.parse(fs.readFileSync(memPath,"utf8"));
mem.leads[url]={...(mem.leads[url]||{}),outcome:"em_andamento",at:new Date().toISOString(),slug};
fs.writeFileSync(memPath,JSON.stringify(mem,null,2)+"\\n");`;
const STUBS = {
  ok: `${RASTRO}
console.log("qoder/Efficient: texto escrito (stub)");`,
  falha: `console.log("qoder/Efficient: HTTP 500: timeout de 540s no CLI");
console.error("não saiu texto em 14min, em nenhum provedor armado.");
process.exit(1);`,
};

function planta(opcoes = {}) {
  const dir = destravaAgenda(copia());
  fs.writeFileSync(path.join(dir, "tools", "write.js"), `// fixture\n${STUBS[opcoes.redator === "falha" ? "falha" : "ok"]}\n`);
  if (opcoes.lock) {
    const alvo = path.join(dir, "pipeline", "state", "round-lock.json");
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, JSON.stringify({ servidas: opcoes.lock.map((r) => ({ rodada: r, at: new Date().toISOString(), resultado: "planta da prova" })), updated: new Date().toISOString() }, null, 2) + "\n");
  }
  if (opcoes.semLock) fs.rmSync(path.join(dir, "pipeline", "state", "round-lock.json"), { force: true });
  /* Cadência plantada DEPOIS da limpeza de agenda, para as duas contas baterem
     com o número escolhido (teto lido de memory + git log, gap lido da última
     publicação). `noDia: n` enche o dia UTC até n publicações; `gap: h` põe uma
     peça há exatamente h horas. */
  if (opcoes.noDia !== undefined || opcoes.gap !== undefined) {
    const memP = path.join(dir, "pipeline", "memory.json");
    const mem = JSON.parse(fs.readFileSync(memP, "utf8"));
    const hojeUtc = new Date().toISOString().slice(0, 10);
    if (opcoes.noDia !== undefined) {
      mem.publishes = [];
      for (let i = 0; i < opcoes.noDia; i++) mem.publishes.push({ id: `fixture-teto-${i}`, at: `${hojeUtc}T09:0${i}:00.000Z`, score: 7 });
    } else {
      const at = new Date(Date.now() - opcoes.gap * 3600000);
      /* Tem de cair no dia UTC de hoje, senão quem fecha a rodada é o teto (1/N)
         e não o intervalo — e a asserção passaria pela razão errada. */
      if (at.toISOString().slice(0, 10) !== hojeUtc) throw new Error("caso do gap precisa de janela maior que a distância à meia-noite UTC");
      mem.publishes = [{ id: "fixture-gap", at: at.toISOString(), score: 7 }];
    }
    fs.writeFileSync(memP, JSON.stringify(mem, null, 2) + "\n");
  }
  return dir;
}

function hashArquivo(p) {
  try {
    return require("crypto").createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  } catch {
    return "<ausente>";
  }
}

function retrato(dir) {
  return {
    mem: hashArquivo(path.join(dir, "pipeline", "memory.json")),
    leads: fs.readdirSync(path.join(dir, "pipeline", "leads")).sort().join(","),
    hero: (fs.readFileSync(path.join(dir, "index.html"), "utf8").match(/hwp:auto:index-hero:start([\s\S]*?)hwp:auto:index-hero:end/) || ["<sem hero>"])[0],
    capas: (JSON.parse(fs.readFileSync(path.join(dir, "pipeline", "state", "cover-state.json"), "utf8")).changes || []).length,
    diario: fs.readFileSync(path.join(dir, "TURNO.md"), "utf8"),
  };
}

function roda(dir, args = []) {
  let out = "";
  let code = 0;
  try {
    out = execFileSync(process.execPath, [path.join(dir, "tools", "turno.js"), ...args], { cwd: dir, stdio: "pipe", timeout: 900000 }).toString();
  } catch (err) {
    code = err.status === undefined ? -1 : err.status;
    out = String(err.stdout || "") + String(err.stderr || "");
  }
  return { code, out, depois: retrato(dir), lock: roundLock.ler(dir) };
}

const PULADOS = ["coleta", "rotação diária", "manutenção", "cadência", "pauta", "brief", "texto", "foto", "edição", "nota", "publicação"];
function etapasNaOrdem(diario) {
  const achadas = [];
  for (const etapa of PULADOS) if (diario.includes(`**${etapa}**`)) achadas.push(etapa);
  return achadas;
}

/* A pauta queimada é a diferença entre as duas memórias: qualquer URL que saiu
   de "nunca tentada" para `em_andamento`. Serve ao caso verde (o stub do
   redator grava o rastro) e ao vermelho (o pick-lead real marca antes do texto). */
function queimadasAntesDepois(antes, depois) {
  return Object.keys(depois.leads).filter((u) => depois.leads[u].outcome === "em_andamento" && (!antes.leads[u] || antes.leads[u].outcome !== "em_andamento"));
}

/* ───────────────────────── 1. o portão ───────────────────────── */
console.log(`1. horário ${SLOT} já servido → a segunda mão sai sem tocar em nada`);
{
  const dir = planta({ lock: [SLOT] });
  const antes = retrato(dir);
  /* O preço de não barrar, medido na fixture irmã (portão aberto para OUTRO
     horário): a mesma rodada queima pauta. Sem isto, "memory byte a byte" seria
     uma asserção vazia — pode ser que nenhuma boca escreva nunca. */
  const dirCusto = planta({ lock: [OUTRO] });
  const antesCusto = JSON.parse(fs.readFileSync(path.join(dirCusto, "pipeline", "memory.json"), "utf8"));
  roda(dirCusto);
  const depoisCusto = JSON.parse(fs.readFileSync(path.join(dirCusto, "pipeline", "memory.json"), "utf8"));
  confere("com o portão ABERTO a mesma rodada queima pauta (a comparação abaixo mede algo)", queimadasAntesDepois(antesCusto, depoisCusto).length > 0, "sem isto, 'memory byte a byte' seria vazio");
  const r = roda(dir);
  confere("exit 0 (mão duplicada não é rodada vermelha)", r.code === 0, `código ${r.code} · ${r.out.split("\n").filter((l) => /VERMELHO/.test(l)).join(" ⏎ ")}`);
  confere("nenhum VERMELHO no stdout — o vigia tem de ler a rodada como servida", !/VERMELHO/.test(r.out), r.out.split("\n").filter((l) => /VERMELHO/.test(l)).join(" ⏎ "));
  confere("a linha diz que o horário já foi servido, nomeando o slot", new RegExp(`rodada duplicada: o horário ${SLOT.replace(":", "\\:")} já foi servido`).test(r.out), r.out.split("\n").slice(0, 4).join(" ⏎ "));
  confere("a linha está no diário", new RegExp(`rodada duplicada: o horário ${SLOT.replace(":", "\\:")} já foi servido`).test(r.depois.diario), r.depois.diario.split("\n").slice(-3).join(" ⏎ "));
  /* A asserção de byte a byte só vale se houver preço a não pagar: na fixture
     irmã o mesmo portão aberto deixa a pauta queimar. */
  confere("o memory.json da fixture está byte a byte como estava", antes.mem === r.depois.mem, `${antes.mem.slice(0, 12)} ≠ ${r.depois.mem.slice(0, 12)}`);
  confere("pipeline/leads/ não ganhou nem perdeu um arquivo", antes.leads === r.depois.leads, `${antes.leads} ≠ ${r.depois.leads}`);
  confere("nenhuma etapa da pipeline rodou (nem coleta, nem manutenção, nem pauta)", etapasNaOrdem(r.depois.diario).length === 0, etapasNaOrdem(r.depois.diario).join(" › "));
  confere("o index-hero do site não se mexeu", antes.hero === r.depois.hero, "o hero mudou numa rodada que não deveria ter rodado");
  confere("o histórico de capas da fixture não cresceu", antes.capas === r.depois.capas, `${antes.capas} → ${r.depois.capas}`);
  confere("o portão não re-escreveu o próprio estado (a trava continua com 1 horário)", r.lock.servidas.length === 1 && r.lock.servidas[0].rodada === SLOT, JSON.stringify(r.lock.servidas));
}

/* ───────────────────────── 2. a chave é a rodada ───────────────────────── */
console.log(`\n2. a trava é por horário: plantar OUTRO balde (${OUTRO}) não serve o de hoje`);
{
  const dir = planta({ lock: [OUTRO] });
  const antes = JSON.parse(fs.readFileSync(path.join(dir, "pipeline", "memory.json"), "utf8"));
  const r = roda(dir);
  const depois = JSON.parse(fs.readFileSync(path.join(dir, "pipeline", "memory.json"), "utf8"));
  confere("com trava de outro horário a rodada percorre a pipeline até o redator", etapasNaOrdem(r.depois.diario).includes("texto"), etapasNaOrdem(r.depois.diario).join(" › ") || `código ${r.code}`);
  confere("e queima pauta (é isto que o portão tem de evitar)", queimadasAntesDepois(antes, depois).length > 0, "a asserção de cima não estaria medindo preço nenhum");
  confere("e o portão não imprimiu a linha de duplicata", !/rodada duplicada/.test(r.out), r.out.split("\n").slice(0, 3).join(" ⏎ "));
  confere("no fim o horário de HOJE entra na trava ao lado do outro", r.lock.servidas.some((s) => s.rodada === SLOT) && r.lock.servidas.some((s) => s.rodada === OUTRO), JSON.stringify(r.lock.servidas.map((s) => s.rodada)));
  confere("a chave do portão É o cover-state.rodadaId(), não uma conta paralela", roundLock.chave() === coverState.rodadaId(), `${roundLock.chave()} ≠ ${coverState.rodadaId()}`);
  const dir2 = planta({ lock: [SLOT, OUTRO, `${new Date(Date.now() - 86400000).toISOString().slice(0, 10)}T23:59`] });
  const r2 = roda(dir2);
  confere("trava com vários horários ainda pega o de agora", r2.code === 0 && /rodada duplicada/.test(r2.out), `código ${r2.code} · ${r2.out.split("\n").slice(0, 3).join(" ⏎ ")}`);
}

/* ───────────────────────── 3. quem marca, quando ───────────────────────── */
console.log("\n3. a marca vem no DESFECHO: verde e parada por cadência marcam, vermelho não");
{
  const dirSem = planta({ semLock: true });
  const memSem = JSON.parse(fs.readFileSync(path.join(dirSem, "pipeline", "memory.json"), "utf8"));
  const rSem = roda(dirSem);
  confere("sem round-lock.json na mesa a rodada roda normal (portão fecha aberto)", !/rodada duplicada/.test(rSem.out) && etapasNaOrdem(rSem.depois.diario).includes("texto"), rSem.out.split("\n").slice(0, 3).join(" ⏎ "));
  confere("e o horário fica marcado ao final", rSem.lock.servidas.filter((s) => s.rodada === SLOT).length === 1, JSON.stringify(rSem.lock.servidas));
  confere("a marca carrega o ISO do instante e o desfecho", typeof rSem.lock.servidas.find((s) => s.rodada === SLOT).at === "string" && !Number.isNaN(Date.parse(rSem.lock.servidas.find((s) => s.rodada === SLOT).at)) && !!rSem.lock.servidas.find((s) => s.rodada === SLOT).resultado, JSON.stringify(rSem.lock.servidas.find((s) => s.rodada === SLOT)));
  const rNovamente = roda(dirSem);
  confere("a SEGUNDA mão desta mesma fixture é barrada", rNovamente.code === 0 && /rodada duplicada/.test(rNovamente.out), `código ${rNovamente.code} · ${rNovamente.out.split("\n").slice(0, 2).join(" ⏎ ")}`);

  /* Travão do intervalo: uma peça há 1,5h com o mínimo em 3h. A fixture já está
     sem histórico de hoje (destravaAgenda), então o teto não interfere e quem
     fecha a rodada é o gap — as duas cores são conferidas separadamente. */
  const dirGap = planta({ gap: 1.5 });
  const rGap = roda(dirGap);
  confere("parada por intervalo mínimo fecha verde", rGap.code === 0, `código ${rGap.code} · ${rGap.out.split("\n").filter((l) => /VERMELHO/.test(l)).join(" ⏎ ")}`);
  confere("e a pipeline nem chega à pauta (é o travão do passo 4)", !etapasNaOrdem(rGap.depois.diario).includes("pauta") && /mínimo/.test(rGap.out), etapasNaOrdem(rGap.depois.diario).join(" › ") + " · " + rGap.out.split("\n").slice(-4).join(" ⏎ "));
  confere("mesmo sem publicar o horário é declarado servido (a agenda foi cumprida)", rGap.lock.servidas.some((s) => s.rodada === SLOT), JSON.stringify(rGap.lock.servidas));

  /* Segundo travão do mesmo passo: o teto cheio no dia UTC. */
  const teto = Number(JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "cadence.json"), "utf8")).max_publishes_per_day) || 4;
  const dirTeto = planta({ noDia: teto });
  const rTeto = roda(dirTeto);
  confere("teto atingido também fecha verde", rTeto.code === 0, `código ${rTeto.code} · ${rTeto.out.split("\n").filter((l) => /VERMELHO/.test(l)).join(" ⏎ ")}`);
  confere("com o travão do teto no caminho (sem pauta queimada)", /teto diário atingido/.test(rTeto.out) && !etapasNaOrdem(rTeto.depois.diario).includes("pauta"), rTeto.out.split("\n").slice(-4).join(" ⏎ "));
  confere("e o horário igualmente entra na trava", rTeto.lock.servidas.some((s) => s.rodada === SLOT), JSON.stringify(rTeto.lock.servidas.map((s) => s.rodada)));

  const dirVerm = planta({ redator: "falha" });
  const memVerm = JSON.parse(fs.readFileSync(path.join(dirVerm, "pipeline", "memory.json"), "utf8"));
  const rVerm = roda(dirVerm);
  const depoisVerm = JSON.parse(fs.readFileSync(path.join(dirVerm, "pipeline", "memory.json"), "utf8"));
  confere("rodada que morre no redator sai vermelha", rVerm.code === 1, `código ${rVerm.code} · ${rVerm.out.split("\n").filter((l) => /VERMELHO/.test(l)).join(" ⏎ ")}`);
  confere("VERMELHO no stdout com a causa do redator (o contrato do vigia)", /^VERMELHO: o redator não entregou texto/m.test(rVerm.out), rVerm.out.split("\n").filter((l) => /VERMELHO/.test(l)).join(" ⏎ "));
  confere("a pauta foi queimada pelo passo 5 mesmo assim — é o preço de rodar e morrer", queimadasAntesDepois(memVerm, depoisVerm).length > 0, "sem esta asserção o caso vermelho seria vazio");
  confere("e NÃO marca o horário — a mão seguinte ainda pode tentar", !rVerm.lock.servidas.some((s) => s.rodada === SLOT), JSON.stringify(rVerm.lock.servidas.map((s) => s.rodada)));
}

/* ───────────────────────── 4. via deliberada ───────────────────────── */
console.log("\n4. --force-slot: o caminho manual documentado não fica bloqueado");
{
  const dir = planta({ lock: [SLOT] });
  const r = roda(dir, ["--force-slot"]);
  confere("com o portão plantado, --force-slot percorre a pipeline mesmo assim", !/rodada duplicada/.test(r.out) && etapasNaOrdem(r.depois.diario).includes("texto"), r.depois.diario.split("\n").slice(0, 8).join(" ⏎ ") || `código ${r.code}`);
  confere("a linha de bypass nomeia o horário ignorado", new RegExp(`portão de idempotência ignorado por --force-slot \\(${SLOT.replace(":", "\\:")}\\)`).test(r.out), r.out.split("\n").slice(0, 3).join(" ⏎ "));
  confere("o bypass está no diário junto das etapas", /\*\*horário\*\* — portão de idempotência ignorado/.test(r.depois.diario), r.depois.diario.split("\n").slice(0, 5).join(" ⏎ "));
  const dirDry = planta({ lock: [SLOT] });
  const rDry = roda(dirDry, ["--dry-run-do-app"]);
  confere("flag que o turno.js não conhece não abre o portão (só --force-slot abre)", rDry.code === 0 && /rodada duplicada/.test(rDry.out), `código ${rDry.code} · ${rDry.out.split("\n").slice(0, 2).join(" ⏎ ")}`);
}

/* ───────────────────────── 5. falsificação ───────────────────────── */
console.log("\n5. falsificação: arrancar a chamada do portão devolve a mão duplicada cara");
{
  const dir = planta({ lock: [SLOT] });
  const arq = path.join(dir, "tools", "turno.js");
  const fonte = fs.readFileSync(arq, "utf8");
  /* Três bocas para a mesma mutação — o guard é um bloco `else if` hoje e pode
     virar uma linha `if (...) saidaCurta(...)` amanhã; falhar as três é a prova
     avisar que desatualizou, não ficar verde por acaso. A árvore de trabalho é
     CRLF e o blob é LF: `\r?\n` nas duas pontas. */
  const MUTACOES = [
    [/ \} else if \(roundLock\.jaServida\([^)]*\)\) \{[\s\S]*?\r?\n\}\r?\n/, "\n"],
    [/else if \(roundLock\.jaServida\([^)]*\)\)[\s\S]*?;\r?\n/, ""],
    [/if \(!FORCAR && roundLock\.jaServida\([^)]*\)\)[\s\S]*?\r?\n\}\r?\n/, "\n"],
  ];
  let mutada = fonte;
  let boca = -1;
  for (let i = 0; i < MUTACOES.length; i++) {
    const t = mutada.replace(MUTACOES[i][0], "/* MUTAÇÃO DA PROVA: portão arrancado */\n");
    if (t !== mutada) { mutada = t; boca = i; break; }
  }
  confere("a mutação encontrou o guard do portão", boca >= 0, "nenhuma das três bocas casou — atualize a mutação");
  fs.writeFileSync(arq, mutada);
  /* `node --check` na cópia mutada: arrancar o bloco sem deixar sintaxe quebrada
     é o que faz a falsificação medir o PORTÃO e não um ReferenceError. */
  let compila = true;
  try {
    execFileSync(process.execPath, ["--check", arq], { stdio: "pipe" });
  } catch {
    compila = false;
  }
  confere("a cópia mutada compila (o que roda é o portão ausente, não um erro de sintaxe)", compila, `node --check não passou em ${arq}`);
  const antes = JSON.parse(fs.readFileSync(path.join(dir, "pipeline", "memory.json"), "utf8"));
  const r = roda(dir);
  const depois = JSON.parse(fs.readFileSync(path.join(dir, "pipeline", "memory.json"), "utf8"));
  const queimadas = Object.keys(depois.leads).filter((u) => !antes.leads[u] || (antes.leads[u].outcome !== "em_andamento" && depois.leads[u].outcome === "em_andamento"));
  confere("sem o guard a segunda mão volta a rodar a pipeline inteira", etapasNaOrdem(r.depois.diario).includes("texto"), etapasNaOrdem(r.depois.diario).join(" › ") || `código ${r.code}`);
  confere("e chama o redator: a pauta sai queimada como em_andamento", queimadas.length > 0, `nenhuma pauta marcada · ${r.out.split("\n").slice(0, 6).join(" ⏎ ")}`);
  if (queimadas.length) {
    const registro = depois.leads[queimadas[0]];
    confere("a marca está na URL da pauta que o log anunciou", new RegExp(String(registro.slug || "").slice(0, 24)).test(r.out + r.depois.diario), `${queimadas[0]} · ${JSON.stringify(registro)}`);
  } else confere("a marca está na URL da pauta que o log anunciou", false, "sem pauta queimada para conferir");
}

/* Varre antes de conferir: uma asserção de limpeza feita depois da própria
   limpeza não prova nada, e resíduo de corrida antiga não pode colocar a prova
   de hoje vermelha. */
for (const dir of new Set([...fixtures, ...fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith("hwp-rodadupla-")).map((d) => path.join(os.tmpdir(), d))])) {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("\n6. invariante: a máquina do dono não foi tocada pela prova");
{
  confere("o TURNO.md real é o mesmo diário de antes", fs.readFileSync(path.join(ROOT, "TURNO.md"), "utf8") === turnAntes);
  confere("a memory.json real não ganhou pauta de fixture", fs.readFileSync(path.join(ROOT, "pipeline", "memory.json"), "utf8") === memAntes);
  confere("o cover-state.json real está byte a byte como estava", fs.readFileSync(path.join(ROOT, "pipeline", "state", "cover-state.json"), "utf8") === coverAntes);
  const lockDepois = fs.existsSync(lockReal) ? fs.readFileSync(lockReal, "utf8") : null;
  confere("o round-lock.json real não foi escrito pela prova", lockDepois === lockAntes, `${String(lockAntes).slice(0, 60)} → ${String(lockDepois).slice(0, 60)}`);
  confere("nenhuma das fixture criadas continua em disco", fixtures.every((d) => !fs.existsSync(d)), fixtures.filter((d) => fs.existsSync(d)).join(", "));
}

console.log(`\n${verde} conferências verdes, ${falhas.length} vermelhas${falhas.length ? ": " + falhas.join(" | ") : ""}.`);
process.exit(falhas.length ? 1 : 0);
