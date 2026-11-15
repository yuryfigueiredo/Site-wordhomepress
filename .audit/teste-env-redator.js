/* teste-env-redator.js — prova de que o redator CLI é lançado SEM a marca de
   sessão do SDK no ambiente do filho.

   O defeito, medido em 15/11 às 01:40 nesta máquina: `qodercli` 1.1.87, quando
   herda `QODER_AGENT_SDK_ENTRYPOINT`, responde no stderr
   `sdk_worker_removed: SDK worker sessions are no longer supported. Upgrade to
   the latest Qoder SDK version, or roll back the CLI to 1.1.80 or earlier.` e
   sai 42 sem escrever uma linha. O `chamarCli` transforma isso em HTTP 500, o
   `write.js` não entrega texto e o `turno.js` fecha a rodada vermelha no passo 7
   — com a pauta marcada `falha_texto`. Sob systemd a variável não existe no
   ambiente do manager do usuário, e é por isso que a rodada do timer escreve
   desde 13/11. Quem está morto é o outro relógio da casa: o LOOP R, a mão de
   reserva que roda 22 min depois de cada horário DENTRO de uma sessão do app, e
   qualquer `node tools/turno.js` que o dono rodar daqui.

   A prova tem três bocas, como as outras da casa: o binário falso mostra o que
   recebeu (o contrato do portão), a mutação arranca o `delete` e mostra o
   veneno passando (a asserção não é vazia), e o binário real do dono confirma
   que a correção vale contra o executável de verdade, não só contra a fixture. */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const VENENO = "sdk-worker-de-prova";
const VAR = "QODER_AGENT_SDK_ENTRYPOINT";

let verde = 0;
const falhas = [];
function confere(nome, ok, dado) {
  if (ok) {
    verde++;
    console.log(`  ✓ ${nome}`);
  } else {
    falhas.push(nome);
    console.log(`  ✗ ${nome}${dado === undefined ? "" : " :: " + String(dado).slice(0, 300)}`);
  }
}

/* Estado do repo REAL antes de qualquer cópia — a invariante do fim. */
const gitAntes = execFileSync("git", ["-C", ROOT, "status", "--porcelain", "-uno"], { encoding: "utf8" });

const dirs = [];
function tmp(prefixo) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
  dirs.push(dir);
  return dir;
}

/* Binário falso: imprime o que recebeu do ambiente e sai 0. É a boca que mede o
   contrato — não o comportamento do CLI do app. */
function binarioFalso(markup) {
  const dir = tmp("hwp-env-");
  const bin = path.join(dir, "fakecli.sh");
  fs.writeFileSync(bin, `#!/bin/sh\necho "${markup}[$\{${VAR}-}\]"\n`);
  fs.chmodSync(bin, 0o755);
  return bin;
}

function carregadores(root) {
  /* Cada raiz tem o próprio cache: a mutação precisa do providers.js da CÓPIA,
     não do da máquina do dono. */
  const arq = path.join(root, "tools", "lib", "providers.js");
  delete require.cache[require.resolve(arq)];
  return require(arq);
}

async function main() {
  process.env[VAR] = VENENO;

  console.log("1. com o guard: o filho não recebe a marca de sessão do SDK");
  {
    const prov = carregadores(ROOT);
    const res = await prov.chamar({ nome: "fixture", tipo: "cli", bin: binarioFalso("RECEBIDO="), max_tokens: 1000 }, "Efficient", "prompt de prova", 30000);
    const texto = await res.text();
    confere("o binário foi lançado e devolveu texto", res.ok === true, texto);
    confere("a variável venenosa NÃO chegou ao filho", /RECEBIDO=\[\]/.test(texto), texto.trim());
    confere("o ambiente do processo pai continua intacto (a limpeza é no filho)", process.env[VAR] === VENENO, process.env[VAR]);
  }

  console.log("\n2. o resto do ambiente passa: não é ambiente esterilizado");
  {
    const dir = tmp("hwp-env-");
    const bin = path.join(dir, "fakecli2.sh");
    fs.writeFileSync(bin, "#!/bin/sh\necho \"HOME=[${HOME:-}] PATH=[${PATH:+sim}] OUTRO=[${HWP_CANARINHO:-}]\"\n");
    fs.chmodSync(bin, 0o755);
    process.env.HWP_CANARINHO = "passou";
    const prov = carregadores(ROOT);
    const res = await prov.chamar({ nome: "fixture", tipo: "cli", bin }, "Efficient", "prompt de prova", 30000);
    const texto = await res.text();
    confere("HOME chegou ao filho", /HOME=\[\/home\//.test(texto), texto.trim());
    confere("PATH chegou ao filho", /PATH=\[sim\]/.test(texto), texto.trim());
    confere("uma variável qualquer do dono chegou também", /OUTRO=\[passou\]/.test(texto), texto.trim());
    delete process.env.HWP_CANARINHO;
  }

  console.log("\n3. falsificação: sem o `delete`, o veneno passa (a asserção não é vazia)");
  {
    const dir = tmp("hwp-env-repo-");
    execFileSync("cp", ["-a", `${ROOT}/.`, `${dir}/`], { stdio: "ignore" });
    const arq = path.join(dir, "tools", "lib", "providers.js");
    const antes = fs.readFileSync(arq, "utf8");
    const depois = antes.replace(/^\s*delete\s+ambiente\.QODER_AGENT_SDK_ENTRYPOINT;\s*$/m, "");
    confere("a mutação encontrou e arrancou a linha do guard", depois !== antes, antes.split("\n").filter((l) => /delete ambiente\./.test(l)).join(" ⏎ "));
    fs.writeFileSync(arq, depois);
    const bin = binarioFalso("RECEBIDO=");
    delete require.cache[require.resolve(path.join(ROOT, "tools", "lib", "providers.js"))];
    const prov = carregadores(dir);
    const res = await prov.chamar({ nome: "fixture", tipo: "cli", bin, max_tokens: 1000 }, "Efficient", "prompt de prova", 30000);
    const texto = await res.text();
    confere("sem o guard o filho HERDA a marca de sessão", new RegExp(`RECEBIDO=\\[${VENENO}\\]`).test(texto), texto.trim());
  }

  console.log("\n4. contra o binário real do dono (não só a fixture)");
  {
    const prov = carregadores(ROOT);
    const armados = prov.armados().filter((p) => p.tipo === "cli");
    if (!armados.length) {
      console.log("  · nenhum provedor do tipo cli armado — nada a conferir no binário real");
    } else {
      const p = armados[0];
      const modelo = Array.isArray(p.fila) && p.fila.length ? p.fila[0] : undefined;
      const res = await prov.chamar({ ...p, fila: undefined }, modelo, 'Responda apenas {"oi":true}', 120000);
      const texto = await res.text();
      confere(`o \`${p.nome}\` real respondeu com o ambiente limpo (HTTP ${res.status})`, res.ok === true, texto.slice(0, 200));
      confere("e a resposta não é o `sdk_worker_removed`", !/sdk_worker_removed/i.test(texto), texto.slice(0, 200));
    }
  }

  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });

  console.log("\n5. invariante: a prova não tocou no repo do dono");
  {
    const gitDepois = execFileSync("git", ["-C", ROOT, "status", "--porcelain", "-uno"], { encoding: "utf8" });
    confere("nenhum arquivo rastreado do repo real se mexeu", gitDepois === gitAntes, gitDepois.split("\n").join(" ⏎ "));
    confere("nenhum diretório de prova ficou em disco", dirs.every((d) => !fs.existsSync(d)));
  }

  console.log(`\n${verde} conferências verdes, ${falhas.length} vermelhas${falhas.length ? ": " + falhas.join(" | ") : ""}.`);
  process.exit(falhas.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`a prova morreu: ${err && err.stack ? err.stack : err}`);
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  process.exit(1);
});
