/* teste-vermelho-redator.js — prova de que a rodada que não entrega texto fecha
   VERMELHA, e de que o VERMELHO chega ao turno.log onde o vigia o procura.

   O defeito, medido em 14/11: duas rodadas (08:23 e 12:23) morreram no passo 7
   com `qoder/Efficient: HTTP 500: timeout de 300s no CLI`, o `finish` tinha
   exit 0, o runner não fez o recuo, commitou `turno:`, empurrou — e o vigia,
   que varre o bloco da rodada atrás do token `VERMELHO` para não cantar verde
   numa rodada morta, não achou o token em lugar nenhum e anunciou "servida e
   empurrada". Zero publicações e aviso verde no mesmo minuto.

   Este arquivo roda o VERDADEIRO `tools/turno.js` dentro de uma cópia do repo
   em /tmp, com as etapas de rede e de texto trocadas por stubs que devolvem a
   saída de sempre. O que se confere é o contrato do turno.js — código de saída,
   o token no stdout que vira turno.log, a linha no diário e a memória — não o
   comportamento dos stubs. A falsificação (última seção) desfaz a correção na
   cópia e exige que o verde volte: sem ela, qualquer asserção de exit code é
   vazia.                                                                       */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const { agendaRasa, medir } = require(path.join(__dirname, "agenda-rasa.js"));
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
const gitAntes = execFileSync("git", ["-C", ROOT, "status", "--porcelain", "-uno"], { encoding: "utf8" });
const turnoAntes = fs.readFileSync(path.join(ROOT, "TURNO.md"), "utf8");
const memAntes = fs.readFileSync(path.join(ROOT, "pipeline", "memory.json"), "utf8");

const LEAD = {
  url: "https://fixture.example/vermelho-redator",
  topic: "Pauta de fixture para a prova do vermelho",
  source: "fixture",
  pillar: "science",
  slug: "fixture-vermelho-redator",
  score: 8,
};

/* Os stubs são a boca: cada um devolve a saída que a etapa real devolve nos
   casos que importam (sucesso, ou a linha de erro exatamente como ela aparece
   no turno.log de hoje). */
const STUB = {
  "ingest.js": `console.log("coleta ok (stub)\\nfila: 1 pauta");`,
  "pick-lead.js": `console.log(JSON.stringify(${JSON.stringify(LEAD)}));`,
  /* O brief real É o diretório pipeline/drafts/<slug>/ — sem ele o fix.md do
     passo 8 arrebenta em ENOENT e o caso morreria por fixture, não por contrato. */
  "new-post.js-ok": `const fs = require("fs");
fs.mkdirSync("pipeline/drafts/${LEAD.slug}", { recursive: true });
console.log("brief criado (stub)");`,
  "new-post.js-falha": `console.error("new-post.js arrebentou: TypeError Cannot read properties of undefined"); process.exit(1);`,
  "write.js-ok": `console.log("texto escrito (stub)");`,
  "write.js-falha": `console.log("qoder/Efficient: HTTP 500: timeout de 300s no CLI"); console.error("não saiu texto em 6min, em nenhum provedor armado."); process.exit(1);`,
  /* A segunda chamada é a reescrita do editor mecânico (passo 8). O contador
     vive no tools/ da FIXTURE — cada caso tem uma cópia, e o processo é outro a
     cada chamada, então o estado tem de ir ao disco. É exatamente a forma do
     defeito medido em 15/11 às 05:44Z: o texto saiu (1146 palavras), o
     check-post reprovou uma frase de 33 palavras e a reescrita voltou sem nada
     depois de ~13 min de parede. */
  "write.js-reescreva-morta": `const fs = require("fs");
const c = __dirname + "/contador-escrita";
const n = fs.existsSync(c) ? Number(fs.readFileSync(c, "utf8")) : 0;
fs.writeFileSync(c, String(n + 1));
if (n === 0) { console.log("texto escrito (stub)"); process.exit(0); }
console.log("qoder/Efficient: HTTP 500: timeout de 900s no CLI");
console.error("não saiu texto em 14min, em nenhum provedor armado. O que houve:");
console.error("  · qoder/Efficient: HTTP 500: timeout de 900s no CLI");
console.error("A rodada termina aqui de propósito: sem texto não há o que checar nem publicar.");
process.exit(1);`,
  "find-cover.js": `console.log("✓ foto encontrada (stub)");`,
  "make-cover.js": `console.log("placa de capa (stub)");`,
  "check-post.js": `console.log("aprovado (stub)");`,
  /* Reprovação mecânica com a linha exatamente como o check-post real devolve:
     o turno.js pesca as linhas com ✗ e monta o fix.md. */
  "check-post.js-reprovado": `console.log("reprovado (stub)");
console.log("  ✗ [rhythm] frase com 33 palavras (máximo 30)");
process.exit(1);`,
  "score.js": `console.log("nota 7.5/10 (stub)");`,
  "publish.js": `console.log("publicado localmente (stub)");`,
  "build.js-daily-falha": `console.error("build --daily morreu (stub)"); process.exit(1);`,
};

/* planta({escrita: "falha", brief: "ok", diario: "stub"}) → uma cópia do repo
   com os stubs pedidos e a memória ajustada para a rodada chegar onde o caso
   manda. `gap` força o travão de cadência do passo 4. */
function planta(opciones) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwp-vermelho-"));
  fixtures.push(dir);
  /* O cabo com "/." é o que copia o CONTEÚDO: sem ele o cp leva a pasta inteira
     para dentro da fixture e nenhum stub existe no caminho que o turno.js lê. */
  execFileSync("cp", ["-a", `${ROOT}/.`, `${dir}/`], { stdio: "ignore" });
  const grava = (arq, corpo) => fs.writeFileSync(path.join(dir, "tools", arq), `// fixture\n${corpo}\n`);

  grava("ingest.js", STUB["ingest.js"]);
  grava("pick-lead.js", STUB["pick-lead.js"]);
  grava("new-post.js", opciones.brief === "falha" ? STUB["new-post.js-falha"] : STUB["new-post.js-ok"]);
  grava("write.js", opciones.escrita === "falha" ? STUB["write.js-falha"]
    : opciones.escrita === "reescreva-morta" ? STUB["write.js-reescreva-morta"]
    : STUB["write.js-ok"]);
  grava("find-cover.js", STUB["find-cover.js"]);
  grava("make-cover.js", STUB["make-cover.js"]);
  grava("check-post.js", opciones.editor === "falha" ? STUB["check-post.js-reprovado"] : STUB["check-post.js"]);
  grava("score.js", STUB["score.js"]);
  grava("publish.js", STUB["publish.js"]);
  if (opciones.diario === "falha") grava("build.js", STUB["build.js-daily-falha"]);

  /* A mesa tem de estar rasa nas TRÊS fontes da régua de cadência, não numa só:
     `pipeline/memory.json`, o portão do passo 0 (`round-lock.json`) e — o que o
     `cp -a` trazia inteiro da máquina do dono — `git log --since=<hoje>T00:00Z`
     filtrando `publish:`, segunda fonte de `lib/cadence.js`. Com a peça real das
     22:38 no ar, a fixture parava no travão do passo 4 ("a última matéria está
     no ar há 2.7h") antes de chegar ao redator: 8 das 21 conferências morriam
     pela janela do relógio, não pelo contrato. Medido em 15/11. O caso `gap`
     planta o travão DEPOIS, de propósito, e por isso a limpeza vem antes. */
  agendaRasa(dir);
  const memArq = path.join(dir, "pipeline", "memory.json");
  const mem = JSON.parse(fs.readFileSync(memArq, "utf8"));
  if (opciones.gap) mem.publishes.push({ id: "fixture-publicada-agora", at: new Date().toISOString(), score: 7 });
  fs.writeFileSync(memArq, JSON.stringify(mem, null, 2) + "\n");
  const mesa = medir(dir);
  if (mesa.servida || (!opciones.gap && (mesa.hoje !== 0 || (mesa.gap !== null && mesa.gap < mesa.min))))
    throw new Error(`fixture com agenda suja: ${JSON.stringify(mesa)}`);
  return dir;
}

function roda(dir) {
  let out = "";
  let code = 0;
  try {
    out = execFileSync(process.execPath, [path.join(dir, "tools", "turno.js")], { cwd: dir, stdio: "pipe", timeout: 180000 }).toString();
  } catch (err) {
    code = err.status === undefined ? -1 : err.status;
    out = String(err.stdout || "") + String(err.stderr || "");
  }
  const diario = fs.readFileSync(path.join(dir, "TURNO.md"), "utf8");
  const mem = JSON.parse(fs.readFileSync(path.join(dir, "pipeline", "memory.json"), "utf8"));
  return { code, out, diario, mem };
}

console.log("1. o redator morre no passo 7 → rodada VERMELHA com a causa no stdout");
{
  const r = roda(planta({ escrita: "falha" }));
  confere("exit 1 (era 0: o verde que empurrava a rodada vazia)", r.code === 1, `código ${r.code}`);
  confere("o stdout traz o token que o vigia procura, no começo da linha", /^VERMELHO: o redator não entregou texto/m.test(r.out), r.out.split("\n").filter((l) => /VERMELHO/.test(l)).join(" ⏎ "));
  confere("a causa real está no token, não só o rótulo", /timeout de 300s no CLI/.test(r.out), r.out.slice(-300));
  confere("o diário guarda a mesma linha", /VERMELHO: o redator não entregou texto/.test(r.diario), r.diario.split("\n").slice(-3).join(" ⏎ "));
  const registro = r.mem.leads[LEAD.url];
  confere("a pauta fica marcada falha_texto (e não sumida)", registro && registro.outcome === "falha_texto", JSON.stringify(registro));
}

console.log("\n2. o brief morre no passo 6 → mesma cor, mesma boca");
{
  const r = roda(planta({ brief: "falha" }));
  confere("exit 1", r.code === 1, `código ${r.code}`);
  confere("VERMELHO aponta o brief", /^VERMELHO: brief falhou/m.test(r.out), r.out.split("\n").filter((l) => /VERMELHO/.test(l)).join(" ⏎ "));
  confere("a pauta sai da fila como falha_brief", r.mem.leads[LEAD.url] && r.mem.leads[LEAD.url].outcome === "falha_brief", JSON.stringify(r.mem.leads[LEAD.url]));
}

console.log("\n3. a rotação diária morre no passo 2 → o token não é só do redator");
{
  const r = roda(planta({ escrita: "ok", diario: "falha" }));
  confere("exit 1", r.code === 1, `código ${r.code}`);
  confere("VERMELHO na saída", /^VERMELHO: /m.test(r.out), r.out.split("\n").filter((l) => /VERMELHO/.test(l)).join(" ⏎ "));
}

console.log("\n4. controle: parada por cadência continua VERDE e sem token");
{
  const r = roda(planta({ escrita: "ok", gap: true }));
  confere("exit 0 (teto/gap é comportamento, não falha)", r.code === 0, `código ${r.code} · ${r.out.split("\n").filter((l) => /VERMELHO/.test(l)).join(" ⏎ ")}`);
  confere("nenhum VERMELHO no log de uma rodada verde", !/VERMELHO/.test(r.out), r.out.split("\n").filter((l) => /VERMELHO/.test(l)).join(" ⏎ "));
  confere("a capa rodou mesmo sem publicar", /index-hero:/.test(r.out), r.out.split("\n").filter((l) => /\[capa\]/.test(l)).join(" ⏎ "));
}

console.log("\n5. falsificação: tirar o exit 1 do passo 7 devolve o verde mudo");
{
  const dir = planta({ escrita: "falha" });
  const arq = path.join(dir, "tools", "turno.js");
  const linhas = fs.readFileSync(arq, "utf8").split("\n");
  const i = linhas.findIndex((l) => l.includes("finish(`o redator não entregou texto"));
  confere("a mutação encontrou a linha do redator", i >= 0, `linha ${i}`);
  /* `\s$` porque a árvore de trabalho desta máquina é CRLF e o blob é LF: a
     mesma asserção precisaria valer nos dois. */
  if (i >= 0) linhas[i] = linhas[i].replace(/, 1\);(\s*)$/, ");$1");
  fs.writeFileSync(arq, linhas.join("\n"));
  confere("o exit 1 saiu da linha (a mutação pegou, não ficou lenda)", !/, 1\);/.test(linhas[i]), JSON.stringify(linhas[i]));
  const r = roda(dir);
  confere("sem o exit 1 a rodada volta a fechar verde", r.code === 0, `código ${r.code} — a prova estaria vazia se ainda desse 1`);
  confere("e o vigia ficaria sem token nenhum para ler", !/VERMELHO/.test(r.out), r.out.split("\n").filter((l) => /VERMELHO/.test(l)).join(" ⏎ "));
}

/* 6 — a reescrita do editor morre no passo 8.

        O defeito medido nesta máquina em 15/11, rodada das 02:23: o redator
        entregou 1146 palavras, o check-post reprovou UMA frase de 33 palavras,
        a chamada de reescrita rodou ~13 min e voltou sem texto nenhum. O
        turno.js então (a) imprimiu no diário só a última linha do write.js —
        "A rodada termina aqui de propósito" — jogando fora o `HTTP 500: timeout
        de 900s` que era a causa, (b) registrou a pauta como `reprovada`, que a
        enterra por 72h, e (c) fechou verde com o horário marcado como servido,
        sem peça e sem segunda chance na noite. As três saídas eram o mesmo
        evento visto como outro. A correção trata o passo 8 pelo que ele é: uma
        falha do redator, com a causa inteira e na janela de `falha_texto`. */
console.log("\n6. a reescrita do editor morre no passo 8 → vermelho, causa do redator, pauta de volta em 24h");
{
  const dir = planta({ escrita: "reescreva-morta", editor: "falha" });
  const r = roda(dir);
  confere("exit 1 (sem texto entregue não é rodada servida)", r.code === 1, `código ${r.code} · ${r.out.split("\n").filter((l) => /VERMELHO/.test(l)).join(" ⏎ ")}`);
  confere("VERMELHO aponta a reescrita, não o júri", /^VERMELHO: a reescrita do editor não entregou texto/m.test(r.out), r.out.split("\n").filter((l) => /VERMELHO/.test(l)).join(" ⏎ "));
  confere("a causa do write.js está no token: as últimas 8 linhas, não a de rodapé", /timeout de 900s no CLI/.test(r.out), r.out.split("\n").filter((l) => /VERMELHO/.test(l)).join(" ⏎ "));
  confere("a mesma linha sobrevive no diário", /VERMELHO: a reescrita do editor não entregou texto/.test(r.diario), r.diario.split("\n").slice(-4).join(" ⏎ "));
  const registro = r.mem.leads[LEAD.url];
  confere("a pauta fica falha_texto, não reprovada", registro && registro.outcome === "falha_texto", JSON.stringify(registro));
  confere("o diário não mente 'reprovado depois de 3 tentativas'", !/reprovado depois de 3 tentativas/.test(r.diario), r.diario.split("\n").filter((l) => /tentativas|reprovada/.test(l)).join(" ⏎ "));
  confere("o horário não fica marcado como servido (a mão de reserva pode refazê-lo)", medir(dir).servida === false, JSON.stringify(medir(dir)));
}

/* 7 — controle: o mesmo júri rigoroso, mas com o redator entregando as três
        reescritas. Aqui `reprovada` (72h) e verde SÃO o caminho certo: foi a
        peça que não passou, não a máquina. Esta é a conferência que impede a
        correção de 6 de transformar toda reprovação em emergência vermelha. */
console.log("\n7. controle: reprovação editorial de verdade continua verde, com a pauta em reprovada");
{
  const dir = planta({ escrita: "ok", editor: "falha" });
  const r = roda(dir);
  confere("exit 0 (júri rigoroso é trabalho editorial, não falha do relógio)", r.code === 0, `código ${r.code} · ${r.out.split("\n").filter((l) => /VERMELHO/.test(l)).join(" ⏎ ")}`);
  confere("nenhum VERMELHO na rodada que o editor reprovou de verdade", !/VERMELHO/.test(r.out), r.out.split("\n").filter((l) => /VERMELHO/.test(l)).join(" ⏎ "));
  confere("as três tentativas aconteceram e o diário diz as três", /tentativa 3 reprovada/.test(r.diario) && /reprovado depois de 3 tentativas/.test(r.diario), r.diario.split("\n").filter((l) => /edição|fim/.test(l)).join(" ⏎ "));
  confere("a pauta sai reprovada (72h)", r.mem.leads[LEAD.url] && r.mem.leads[LEAD.url].outcome === "reprovada", JSON.stringify(r.mem.leads[LEAD.url]));
  confere("a capa girou mesmo sem publicar", /index-hero:/.test(r.out), r.out.split("\n").filter((l) => /\[capa\]/.test(l)).join(" ⏎ "));
  confere("e o horário ficou servido", medir(dir).servida === true, JSON.stringify(medir(dir)));
}

/* 8 — falsificações. Duas bocas, dois estragos diferentes: desligar o ramo
        devolve o verde que enterra a pauta; encurtar a fatia de causa devolve o
        diário mudo. Sem elas, as asserções de 6 são só descrições do código. */
console.log("\n8. falsificação A: desligado o ramo da reescrita, volta o verde que enterra a pauta por 72h");
{
  const dir = planta({ escrita: "reescreva-morta", editor: "falha" });
  const arq = path.join(dir, "tools", "turno.js");
  const linhas = fs.readFileSync(arq, "utf8").split("\n");
  const i = linhas.findIndex((l) => l.includes("if (reescritaMorta) {"));
  confere("a mutação encontrou o ramo da reescrita", i >= 0, `linha ${i}`);
  if (i >= 0) linhas[i] = linhas[i].replace("if (reescritaMorta) {", "if (reescritaMorta && null) {");
  fs.writeFileSync(arq, linhas.join("\n"));
  confere("a mutação pegou (o ramo está desligado no arquivo)", linhas[i].includes("&& null"), JSON.stringify(linhas[i]));
  const r = roda(dir);
  confere("sem o ramo a rodada fecha verde outra vez", r.code === 0, `código ${r.code}`);
  confere("e a pauta vira reprovada: 72h fora da fila por um timeout", r.mem.leads[LEAD.url] && r.mem.leads[LEAD.url].outcome === "reprovada", JSON.stringify(r.mem.leads[LEAD.url]));
  confere("o diário volta a mentir a causa", /reprovado depois de 3 tentativas/.test(r.diario), r.diario.split("\n").slice(-3).join(" ⏎ "));
}

console.log("\n9. falsificação B: causa cortada na última linha devolve o diário sem o porquê");
{
  const dir = planta({ escrita: "reescreva-morta", editor: "falha" });
  const arq = path.join(dir, "tools", "turno.js");
  const linhas = fs.readFileSync(arq, "utf8").split("\n");
  const i = linhas.findIndex((l) => l.includes("fix.out.trim().split(\"\\n\").slice(-8)"));
  confere("a mutação encontrou a fatia de causa", i >= 0, `linha ${i}`);
  linhas[i] = linhas[i].replace('.split("\\n").slice(-8).join(" · ")', '.split("\\n").slice(-1)[0]');
  fs.writeFileSync(arq, linhas.join("\n"));
  confere("a fatia encolheu no arquivo", /slice\(-1\)/.test(linhas[i]), JSON.stringify(linhas[i].trim()));
  const r = roda(dir);
  confere("a cor continua vermelha (a mutação é da causa, não do portão)", r.code === 1, `código ${r.code}`);
  confere("mas o timeout desapareceu do token: sobra a linha de rodapé", !/900s/.test(r.out) && /termina aqui de propósito/.test(r.out), r.out.split("\n").filter((l) => /VERMELHO/.test(l)).join(" ⏎ "));
}

/* Varre só as fixtures DESTA corrida. A versão anterior passava o prefixo no
   os.tmpdir() e apagava também as cópias de quem estivesse rodando a mesma
   prova ao mesmo tempo — nesta máquina um revisor audita enquanto o dono
   trabalha, e o estrago aparecia como vermelho no código do dono. Cada `planta()`
   já registra o próprio caminho em `fixtures`.                                */
for (const dir of fixtures) {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("\n10. invariante: a máquina do dono não foi tocada pela prova");
{
  const gitDepois = execFileSync("git", ["-C", ROOT, "status", "--porcelain", "-uno"], { encoding: "utf8" });
  confere("o repo real está como estava", gitDepois === gitAntes, gitDepois.split("\n").join(" ⏎ "));
  confere("o TURNO.md real é o mesmo diário de antes", fs.readFileSync(path.join(ROOT, "TURNO.md"), "utf8") === turnoAntes);
  confere("a memory.json real não ganhou pauta de fixture", fs.readFileSync(path.join(ROOT, "pipeline", "memory.json"), "utf8") === memAntes);
  confere("nenhuma das fixture criadas continua em disco", fixtures.every((d) => !fs.existsSync(d)), fixtures.filter((d) => fs.existsSync(d)).join(", "));
}

console.log(`\n${verde} conferências verdes, ${falhas.length} vermelhas${falhas.length ? ": " + falhas.join(" | ") : ""}.`);
process.exit(falhas.length ? 1 : 0);
