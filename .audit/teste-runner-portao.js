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
