/* agenda-rasa.js —_helper das provas que precisam de um repo cópia COM AGENDA
   LIVRE. Não é asserção, é mecânica: quem confere são os testes, cada um com
   seus próprios nomes (00.a/00.b/00.c em teste-roda-dupla).

   Por que um módulo e não dois blocos copiados: `lib/cover-rules.js`,
   `lib/picks-rules.js` e `lib/slot-markup.js` existem neste repo porque duas
   implementações paralelas da mesma régua foi o que fez o doctor acusar
   "nenhuma matéria passa do piso" com 7.8 no ar. A régua daqui é a mesma classe
   de conta — "esta rodada pode rodar?" — e ela tem TRÊS fontes, não uma:

   1. `pipeline/memory.json` → `publishes` de hoje;
   2. `git log --since=<hoje>T00:00:00Z` filtrando assunto `publish:` — a segunda
      fonte de `lib/cadence.js`, que um `cp -a` traz inteira da máquina do dono;
   3. `pipeline/state/round-lock.json` → o portão do passo 0 do turno.js.

   Zerar só a memória (ou só o lock) deixa a rodada herdar o estado real da
   máquina e sair cedo por um motivo que não é o contrato provado. Medido em
   15/11: com a publicação das 22:38 no disco, 8 das 21 conferências de
   `teste-vermelho-redator` morreram no travão de cadência ("a última matéria
   está no ar há 2.7h") e 12 de `teste-roda-dupla` no de rodada duplicada. A
   prova passava a valer conforme a hora do dia em que era rodada.

   A receita vem de teste-roda-dupla, onde as duas armadilhas do git já foram
   medidas: `git init` dentro de uma cópia NÃO apaga ref nenhum (reencontra
   `.git/refs/heads/main` e o commit nasce encadeado nos ~180 reais, com as
   publicações de hoje vivas no `--since`), e `git commit --date` só move a data
   de AUTORIA — a de COMMIT, que é a que o `--since` usa, vai por
   `GIT_COMMITTER_DATE`. Por isso a cabeça é movida para um branch unborn ANTES
   do commit, e as duas datas vão pelos meios de sempre.                            */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

/* Os módulos são lidos do repo REAL, como sempre foram nas provas: eles recebem
   a raiz por parâmetro e operam na fixture. Um `require` dentro de /tmp criaria
   uma segunda instância de lib/memory.js apontando para outra raiz. */
const ROOT = path.resolve(__dirname, "..");

/* Devolve o dir, já com agenda rasa, e os números lidos DEPOIS da limpeza para
   quem quiser conferi-los. `chave` é o horário em curso (round-lock.chave());
   quem não passar lê a conta do próprio módulo. */
function agendaRasa(dir, opts = {}) {
  const git = (args, env) =>
    execFileSync("git", args, { cwd: dir, stdio: "ignore", env: { ...process.env, ...(env || {}) } });

  /* (1) memória: nenhuma publicação de hoje. */
  const memP = path.join(dir, "pipeline", "memory.json");
  const mem = JSON.parse(fs.readFileSync(memP, "utf8"));
  mem.publishes = [];
  fs.writeFileSync(memP, JSON.stringify(mem, null, 2) + "\n");

  /* (3) portão do passo 0: o horário em curso sai da lista, os anteriores ficam
     (a poda é MAX_SERVIDAS na leitura) para o histórico continuar real. */
  const lockP = path.join(dir, "pipeline", "state", "round-lock.json");
  if (fs.existsSync(lockP)) {
    const roundLock = require(path.join(ROOT, "tools", "lib", "round-lock.js"));
    const lk = JSON.parse(fs.readFileSync(lockP, "utf8"));
    lk.servidas = (lk.servidas || []).filter((s) => s && s.rodada !== (opts.chave || roundLock.chave()));
    fs.writeFileSync(lockP, JSON.stringify(lk, null, 2) + "\n");
  }

  /* (2) git: histórico renasce num commit só, datado de ONTEM, conservando os
     assuntos reais para a detecção de quase-duplicata continuar vendo títulos. */
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
  const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10) + "T18:00:00Z";
  git(["commit", "-q", "-m", `${assuntos[0] || "fixture"}\n\n${assuntos.slice(1).join("\n")}`], {
    GIT_AUTHOR_DATE: ontem,
    GIT_COMMITTER_DATE: ontem,
  });
  return dir;
}

/* A leitura que as provas conferem depois de montar a mesa. */
function medir(dir) {
  const cadence = require(path.join(ROOT, "tools", "lib", "cadence.js"));
  const roundLock = require(path.join(ROOT, "tools", "lib", "round-lock.js"));
  const cad = JSON.parse(fs.readFileSync(path.join(dir, "pipeline", "cadence.json"), "utf8"));
  return {
    hoje: cadence.publishedToday(dir),
    gap: cadence.horasDesdeUltimaPublicacao(dir),
    min: Number(cad.min_hours_between_publishes),
    servida: roundLock.jaServida(new Date(), dir),
  };
}

module.exports = { agendaRasa, medir };
