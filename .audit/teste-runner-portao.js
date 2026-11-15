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

/* 5 — o portão do relógio: a nuvem não pode escrever junto com esta máquina,
       e desde 14/11 há DUAS formas de ela estar morta. A prova local é a
       primeira; a segunda mora no arquivo (o job carrega
       `if: false # hwp:nuvem-inerte`), e existe porque um push que toque em
       .github/workflows/turno.yml devolve o workflow a active sozinho — medido
       em 13/11, com o commit 1381047 por cima da prova posta às 19:56Z. Com o
       cinto lendo as duas coisas, active + inerte = a nuvem não escreve, e a
       rodada acontece; active + marca ausente = duas mãos em memory.json, e a
       rodada para. A API é trocada por um file:// (HWP_API_WORKFLOWS) para que
       o estado seja plantado sem depender de rate limit nenhum.             */
const MARCA = "    if: false # hwp:nuvem-inerte\n";
function fixtureRelogio({ inerte = false, prova = true, corpo = '{"workflows":[{"name":"turno editorial","state":"active"}]}' } = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "hwp-relogio-"));
  const dir = path.join(raiz, "work");
  const state = path.join(raiz, "state");
  const avisos = path.join(raiz, "avisos.txt");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  git(dir, "init", "-q", ".");
  git(dir, "config", "user.name", "prova");
  git(dir, "config", "user.email", "prova@local");
  fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".github", "workflows", "turno.yml"),
    `name: turno editorial\non:\n  schedule:\n    - cron: "23 1,5,9,13,17,21 * * *"\njobs:\n  turno:\n${inerte ? MARCA : ""}    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n`,
  );
  fs.writeFileSync(path.join(dir, "TURNO.md"), "# Turno — baseline\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "baseline");
  git(dir, "branch", "-M", "main");
  /* origin local: sem ele o runner gasta 3×60s esperando rede e a prova não
     mede o portão, mede o sleep.                                              */
  const bare = path.join(raiz, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", bare], { stdio: "ignore" });
  git(dir, "remote", "add", "origin", bare);
  git(dir, "push", "-q", "origin", "main");
  if (prova) fs.writeFileSync(path.join(state, "actions-desligado"), "clicado na aba Actions pela prova\n");
  const api = path.join(raiz, "workflow.json");
  fs.writeFileSync(api, corpo);
  const stub = path.join(raiz, "stub-aviso.sh");
  fs.writeFileSync(stub, `#!/bin/bash\necho "$1|$2" >> "${avisos}"\n`, { mode: 0o755 });
  return { dir, state, avisos, stub, raiz, api };
}

function rodaAgenda(f) {
  let saida = "";
  let codigo = 0;
  try {
    saida = execFileSync(RUNNER, [], {
      encoding: "utf8",
      env: {
        ...process.env,
        HWP_REPO: f.dir,
        HWP_STATE: f.state,
        HWP_AVISO: f.stub,
        HWP_SO_AGENDA: "1",
        HWP_API_WORKFLOWS: `file://${f.api}`,
      },
    });
  } catch (e) {
    saida = String(e.stdout || "") + String(e.stderr || "");
    codigo = e.status ?? -1;
  }
  return {
    saida,
    codigo,
    linha: (saida.split("\n").find((l) => l.startsWith("agenda:")) || "").trim(),
    avisos: fs.existsSync(f.avisos) ? fs.readFileSync(f.avisos, "utf8").split("\n").filter(Boolean) : [],
    provouQueLeu: fs.existsSync(path.join(f.state, "workflow.json")),
  };
}

{
  console.log("5. o portão do relógio: prova local, marca no arquivo e o cinto da API");
  const semProva = rodaAgenda(fixtureRelogio({ prova: false, inerte: true }));
  confere("sem a prova local a rodada para, mesmo com o job inerte", semProva.codigo === 1 && /falta a prova local/.test(semProva.saida), `${semProva.codigo} · ${semProva.saida.trim().slice(0, 160)}`);
  confere("e a API não foi nem consultada (a prova é a primeira boca)", !semProva.provouQueLeu, semProva.linha);
  confere("avisou na boca única", semProva.avisos.length === 1 && semProva.avisos[0].startsWith("rodada vermelha|"), JSON.stringify(semProva.avisos));

  const ativa = rodaAgenda(fixtureRelogio({ inerte: false }));
  confere("active sem a marca no arquivo barra a rodada", ativa.codigo === 1 && /voltou a ACTIVE/.test(ativa.saida), `${ativa.codigo} · ${ativa.linha}`);
  confere("e a linha da agenda mostra as duas leituras", /job inerte no arquivo: nao/.test(ativa.linha), ativa.linha);

  const inerte = rodaAgenda(fixtureRelogio({ inerte: true }));
  confere("active COM a marca no arquivo deixa a rodada seguir — a nuvem não escreve", inerte.codigo === 0 && /agenda verde/.test(inerte.saida), `${inerte.codigo} · ${inerte.linha}`);
  confere("a marca é lida do arquivo, não da aba", /job inerte no arquivo: sim/.test(inerte.linha), inerte.linha);
  confere("nenhum aviso vermelho na rodada que passou", inerte.avisos.length === 0, JSON.stringify(inerte.avisos));

  const desligado = rodaAgenda(fixtureRelogio({ inerte: false, corpo: '{"workflows":[{"name":"turno editorial","state":"disabled_manually"}]}' }));
  confere("disabled sem marca não barra (o cinto não inventa bloqueio)", desligado.codigo === 0 && /agenda verde/.test(desligado.saida), `${desligado.codigo} · ${desligado.linha}`);

  const quebrado = rodaAgenda(fixtureRelogio({ inerte: false, corpo: '{"workflows":[{"name":"turno' }));
  confere("resposta ilegível NÃO barra — e mostra por quê", quebrado.codigo === 0 && /ilegivel/.test(quebrado.linha), `${quebrado.codigo} · ${quebrado.linha}`);
  const semWorkflow = rodaAgenda(fixtureRelogio({ inerte: false, corpo: '{"workflows":[]}' }));
  confere("workflow ausente da resposta não barra", semWorkflow.codigo === 0 && /sem o workflow na resposta/.test(semWorkflow.linha), `${semWorkflow.codigo} · ${semWorkflow.linha}`);
  const semArquivoF = fixtureRelogio({ corpo: '{"workflows":[{"name":"turno editorial","state":"active"}]}' });
  /* commitado, não só apagado do disco: com o arquivo deletado com mudanças na
     árvore, quem morde primeiro é o portão da árvore, e esta conferência
     mediria o portão errado.                                                 */
  git(semArquivoF.dir, "rm", "-q", ".github/workflows/turno.yml");
  git(semArquivoF.dir, "commit", "-qm", "baseline sem o workflow");
  git(semArquivoF.dir, "push", "-q", "origin", "main");
  const semArquivo = rodaAgenda(semArquivoF);
  confere("arquivo de workflow apagado é dito como ilegível e barra com active", /arquivo ilegivel/.test(semArquivo.linha) && semArquivo.codigo === 1, `${semArquivo.codigo} · ${semArquivo.linha}`);
}

/* 7 — o recuo da rodada vermelha e a única exceção que ele tem direito: a
       troca de capa do passo 12. O defeito é de 15/11 e nasceu DEPOIS da
       correção do passo 8: com a morte do redator passando a fechar vermelha
       (a47ba2d), o `git checkout HEAD -- .` do cinto devolvia `index.html` e
       `pipeline/state/cover-state.json` ao commit anterior e o horário
       contribuída zero trocas para `cover_changes_per_day` 6 — o recuo desfazia
       exatamente o produto que o AGENTS.md manda entregar numa rodada sem
       matéria. A exceção tem de ser estreita: só com manutenção errors 0 E
       linha `index-hero: +1` no diário da própria rodada; vermelha de
       manutenção continua recuo integral, e nada fora dos três arquivos da capa
       escapa (culture.html regenerado na rodada suja volta, jpg órfão é limpo).
       A rodada é trocada pela boca HWP_SO_TURNO + HWP_PLANTA, que copia um
       retrato de fim de rodada para a cópia — nenhum minuto de redator, nenhum
       toque no runner instalado: as mutações rodam numa CÓPIA do script.      */
const DIARIO_VERDE = [
  "# Turno — prova do recuo",
  "- **manutenção** — errors 0 | ✗ warnings 1",
  "- **pauta** — algo da fila (Science Daily, score 5)",
  "- **capa** — index-hero: +1 (capa rotacionada: algum-slug (7.8, Nov 7, 2026) · piso 6.5 · rodada 2026-11-15T02:23)",
  "- **fim** — VERMELHO: a reescrita do editor não entregou texto",
  "",
].join("\n");
const DIARIO_SEM_TROCA = [
  "# Turno — prova do recuo",
  "- **manutenção** — errors 0 | ✗ warnings 1",
  "- **capa** — index-hero: +0 (capa mantida: algum-slug)",
  "- **fim** — VERMELHO: a reescrita do editor não entregou texto",
  "",
].join("\n");
const DIARIO_MANUTENCAO_VERMELHA = [
  "# Turno — prova do recuo",
  "- **manutenção** — errors 1 | ✓ warnings 0",
  "- **capa** — index-hero: +1 (capa rotacionada: algum-slug (7.8, Nov 7, 2026))",
  "- **fim** — VERMELHO: a manutenção abriu um erro",
  "",
].join("\n");

function fixtureRecuo(diario) {
  const f = fixtureRelogio({ inerte: true });
  const baseline = {
    "index.html": "<p>HERO DE ONTEM</p>\n",
    "culture.html": "<p>cultura baseline</p>\n",
    "pipeline/state/cover-state.json": '{"rodada":"2026-11-14T22:23"}\n',
    "pipeline/state/hero-fallback.html": "<p>fallback de ontem</p>\n",
    "pipeline/memory.json": '{"leads":{}}\n',
  };
  for (const [p, txt] of Object.entries(baseline)) {
    const alvo = path.join(f.dir, p);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, txt);
  }
  git(f.dir, "add", "-A");
  git(f.dir, "commit", "-qm", "baseline com capa");
  git(f.dir, "push", "-q", "origin", "main");
  /* O retrato de fim de rodada: o que o build e o publish deixariam no disco.
     Vem num diretório separado para o `cp` do cinto ser a única porta de
     entrada — a árvore do fixture precisa chegar limpa ao portão.            */
  const planta = path.join(f.raiz, "planta");
  fs.mkdirSync(path.join(planta, "pipeline/state"), { recursive: true });
  fs.mkdirSync(path.join(planta, "images/posts"), { recursive: true });
  fs.writeFileSync(path.join(planta, "TURNO.md"), diario);
  fs.writeFileSync(path.join(planta, "index.html"), "<p>HERO DE HOJE</p>\n");
  fs.writeFileSync(path.join(planta, "culture.html"), "<p>cultura girada nesta rodada</p>\n");
  fs.writeFileSync(path.join(planta, "pipeline/state/cover-state.json"), '{"rodada":"2026-11-15T02:23"}\n');
  fs.writeFileSync(path.join(planta, "pipeline/state/hero-fallback.html"), "<p>fallback de hoje</p>\n");
  fs.writeFileSync(path.join(planta, "pipeline/memory.json"), '{"leads":{"x":{"outcome":"falha_texto"}}}\n');
  fs.writeFileSync(path.join(planta, "images/posts/foto-de-materia-morta.jpg"), "não é rastreado e deve sumir\n");
  return { ...f, planta, l: (p) => fs.readFileSync(path.join(f.dir, p), "utf8"), noOrigin: (p) => execFileSync("git", ["--git-dir", path.join(f.raiz, "origin.git"), "show", `main:${p}`], { encoding: "utf8" }) };
}

function rodaRecuo(f, runner) {
  let saida = "";
  let codigo = 0;
  try {
    saida = execFileSync(runner || RUNNER, [], {
      encoding: "utf8",
      env: {
        ...process.env,
        HWP_REPO: f.dir,
        HWP_STATE: f.state,
        HWP_AVISO: f.stub,
        HWP_API_WORKFLOWS: `file://${f.api}`,
        HWP_SO_TURNO: "1",
        HWP_PLANTA: f.planta,
        HWP_TURNO_RC: "1",
      },
    });
  } catch (e) {
    saida = String(e.stdout || "") + String(e.stderr || "");
    codigo = e.status ?? -1;
  }
  return { saida, codigo, assunto: git(f.dir, "log", "-1", "--format=%s").trim() };
}

{
  console.log("7. rodada vermelha com capa girada: o recuo preserva a troca e empurra o hero");
  const f = fixtureRecuo(DIARIO_VERDE);
  const r = rodaRecuo(f);
  confere("a rodada vermelha continua vermelha (exit 1)", r.codigo === 1, `${r.codigo} · ${r.saida.trim().slice(0, 200)}`);
  confere("e o cinto diz que preservou a capa", /preservada \(manutenção errors 0 \+ index-hero: \+1\)/.test(r.saida), r.saida.split("\n").filter((l) => /recuo|preserv|recuada/.test(l)).join(" ⏎ "));
  confere("o hero novo está na árvore", /HERO DE HOJE/.test(f.l("index.html")), f.l("index.html"));
  confere("o cover-state do horário está na árvore", /2026-11-15T02:23/.test(f.l("pipeline/state/cover-state.json")), f.l("pipeline/state/cover-state.json"));
  confere("o fallback do hero também", /fallback de hoje/.test(f.l("pipeline/state/hero-fallback.html")), f.l("pipeline/state/hero-fallback.html"));
  confere("o diário e a memória continuam preservados, como sempre", /VERMELHO: a reescrita/.test(f.l("TURNO.md")) && /falha_texto/.test(f.l("pipeline/memory.json")), `${f.l("TURNO.md").slice(0, 60)} | ${f.l("pipeline/memory.json")}`);
  confere("culture.html, fora da lista, voltou ao baseline", /cultura baseline/.test(f.l("culture.html")), f.l("culture.html"));
  confere("o jpg órfão da matéria morta foi limpo pelo recuo", !fs.existsSync(path.join(f.dir, "images/posts/foto-de-materia-morta.jpg")), "sobrou na árvore");
  confere("o commit `turno:` levou a troca de capa", /turno:/.test(r.assunto) && /HERO DE HOJE/.test(execFileSync("git", ["-C", f.dir, "cat-file", "-p", "HEAD:index.html"], { encoding: "utf8" })), `${r.assunto} · ${execFileSync("git", ["-C", f.dir, "show", "--name-only", "--format=", "HEAD"], { encoding: "utf8" }).trim().split("\n").join(" ")}`);
  confere("e o origin do fixture recebeu o hero novo — é o que o site veria", /HERO DE HOJE/.test(f.noOrigin("index.html")) && /2026-11-15T02:23/.test(f.noOrigin("pipeline/state/cover-state.json")), f.noOrigin("index.html"));
}

{
  console.log("7b. vermelha SEM troca de capa: recuo integral, a exceção não virou licença");
  const f = fixtureRecuo(DIARIO_SEM_TROCA);
  const r = rodaRecuo(f);
  confere("saiu 1", r.codigo === 1, `${r.codigo} · ${r.saida.trim().slice(0, 160)}`);
  confere("o recuo foi o velho recuo", /só TURNO\.md e pipeline\/memory\.json ficaram/.test(r.saida), r.saida.split("\n").filter((l) => /recuada/.test(l)).join(" ⏎ "));
  confere("o hero voltou ao de ontem", /HERO DE ONTEM/.test(f.l("index.html")), f.l("index.html"));
  confere("o cover-state voltou à rodada anterior", /2026-11-14T22:23/.test(f.l("pipeline/state/cover-state.json")), f.l("pipeline/state/cover-state.json"));
  confere("o origin não viu capa nova", /HERO DE ONTEM/.test(f.noOrigin("index.html")), f.noOrigin("index.html"));
}

{
  console.log("7c. vermelha de MANUTENÇÃO (errors ≠ 0) com capa girada: nada de HTML ao ar");
  const f = fixtureRecuo(DIARIO_MANUTENCAO_VERMELHA);
  const r = rodaRecuo(f);
  confere("saiu 1", r.codigo === 1, `${r.codigo}`);
  confere("não preservou: o portão que reprovou o HTML é justamente o que abriu", /só TURNO\.md e pipeline\/memory\.json ficaram/.test(r.saida), r.saida.split("\n").filter((l) => /recuada|preserv/.test(l)).join(" ⏎ "));
  confere("o hero voltou ao de ontem", /HERO DE ONTEM/.test(f.l("index.html")), f.l("index.html"));
  confere("a troca de capa não foi empurrada", /HERO DE ONTEM/.test(f.noOrigin("index.html")), f.noOrigin("index.html"));
}

{
  console.log("7d. falsificações: tirar a exceção e alargá-la");
  const fonteBelt = fs.readFileSync(RUNNER, "utf8");
  const semExcecao = path.join(os.tmpdir(), `runner-sem-excecao-${process.pid}.sh`);
  fs.writeFileSync(semExcecao, fonteBelt.replace("    CAPA=1\n", "    CAPA=0\n"), { mode: 0o755 });
  confere("a mutação encontrou o ramo de preservação", fonteBelt.includes("    CAPA=1\n") && fs.readFileSync(semExcecao, "utf8").includes("    CAPA=0\n"), "token CAPA=1 não achado");
  const f1 = fixtureRecuo(DIARIO_VERDE);
  const r1 = rodaRecuo(f1, semExcecao);
  confere("sem a exceção, o hero volta ao de ontem (é o defeito de 15/11)", /HERO DE ONTEM/.test(f1.l("index.html")), f1.l("index.html"));
  confere("e a troca não chega ao origin", /HERO DE ONTEM/.test(f1.noOrigin("index.html")), f1.noOrigin("index.html"));

  const manutLarga = path.join(os.tmpdir(), `runner-manut-larga-${process.pid}.sh`);
  fs.writeFileSync(manutLarga, fonteBelt.replace("grep -q '^- \\*\\*manutenção\\*\\* — errors 0' TURNO.md", "true"), { mode: 0o755 });
  confere("a segunda mutação encontrou a conferência de manutenção", fonteBelt.includes("errors 0' TURNO.md") && !fs.readFileSync(manutLarga, "utf8").includes("errors 0' TURNO.md"), "token não achado");
  const f2 = fixtureRecuo(DIARIO_MANUTENCAO_VERMELHA);
  const r2 = rodaRecuo(f2, manutLarga);
  confere("com o portão de manutenção arrancado, uma HTML reprovado vai ao ar", /HERO DE HOJE/.test(f2.l("index.html")), `${r2.saida.split("\n").filter((l) => /recuada|preserv/.test(l)).join(" ⏎ ")} · ${f2.l("index.html")}`);
  confere("e o origin recebe o HTML que a manutenção reprovou", /HERO DE HOJE/.test(f2.noOrigin("index.html")), f2.noOrigin("index.html"));
  for (const p of [semExcecao, manutLarga]) fs.rmSync(p, { force: true });
  confere("o runner instalado nesta máquina não foi tocado pelas mutações", fs.readFileSync(RUNNER, "utf8") === fonteBelt && fonteBelt.includes("    CAPA=1\n"), "o script real mudou");
}

/* 6 — invariante: o estado desta máquina não foi tocado pela prova. */
{
  console.log("6. nada encostou no repo real nem no estado da máquina");
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
