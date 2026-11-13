/* teste-provedor-cli.js — prova do tipo "cli" em tools/lib/providers.js.

   Desde 13/11 quem escreve a matéria pode ser o agente do app, chamado como
   subprocesso pelo MESMO write.js que fala com as APIs HTTP. Isso só é seguro
   se o transporte respeitar o contrato que o write.js já assume (.ok, .status,
   .text(), .json()) e se a fila continuar viva quando o binário sumir: app
   desatualizado, logout, plano pago — em todos esses casos o provedor tem de
   ficar INERTE (o pré-voice do runner barra a rodada antes de queimar pauta),
   nunca derrubar a rodada no passo 7 com a pauta já marcada `em_andamento`.

   Nada aqui gasta cota de verdade: os binários são cascas em /tmp que ecoam,
   dormem ou falham. Rode: node .audit/teste-provedor-cli.js                 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const prov = require(path.join(ROOT, "tools", "lib", "providers.js"));

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hwp-cli-"));
function casca(nome, corpo) {
  const p = path.join(tmp, nome);
  fs.writeFileSync(p, `#!/bin/bash\n${corpo}\n`, { mode: 0o755 });
  return p;
}

/* 1 — localizar: a ordem declarada no comentário do módulo. */
{
  console.log("1. localizar() — bin > $QODER_CLI > mais novo em ~/.qoder > PATH");
  const explicito = casca("bin-explicito", 'echo "{}"');
  confere("`bin` do JSON vence tudo", prov.localizar({ bin: explicito }) === explicito, String(prov.localizar({ bin: explicito })));

  const fakeHome = path.join(tmp, "home");
  const dirCli = path.join(fakeHome, ".qoder", "bin", "qodercli");
  fs.mkdirSync(dirCli, { recursive: true });
  for (const v of ["qodercli-1.1.87", "qodercli-1.1.100", "qodercli-1.1.9"]) fs.writeFileSync(path.join(dirCli, v), "#!/bin/bash\n");
  const HOME_ANTES = process.env.HOME;
  process.env.HOME = fakeHome;
  const achado = prov.localizar({ bin_nome: "qodercli" });
  confere("escolhe o mais novo por versão, não por corda", /qodercli-1\.1\.100$/.test(achado || ""), String(achado));

  const peloEnv = casca("pelo-env", 'echo "{}"');
  process.env.QODER_CLI = peloEnv;
  confere("$QODER_CLI manda sobre a varredura", prov.localizar({ bin_nome: "qodercli" }) === peloEnv, String(prov.localizar({ bin_nome: "qodercli" })));
  delete process.env.QODER_CLI;

  process.env.HOME = path.join(tmp, "sem-home");
  const dirPath = path.join(tmp, "binpath");
  fs.mkdirSync(dirPath, { recursive: true });
  const noPath = path.join(dirPath, "qodercli");
  fs.writeFileSync(noPath, "#!/bin/bash\n");
  process.env.PATH = `${dirPath}:${process.env.PATH}`;
  confere("cai no PATH quando não há ~/.qoder", prov.localizar({ bin_nome: "qodercli" }) === noPath, String(prov.localizar({ bin_nome: "qodercli" })));

  const ausente = prov.localizar({ bin_nome: "qodercli-que-nao-existe" });
  confere("binário inexistente devolve null (provedor fica inerte)", ausente === null, String(ausente));
  process.env.HOME = HOME_ANTES;
}

/* 2 — fila: provedor cli sem binário sai de armados() e entra em desarmados() com o rótulo certo. */
{
  console.log("2. armados()/desarmados() com o binário ausente");
  const sem = prov.desarmados().find((p) => p.tipo === "cli");
  const rotulos = prov.desarmados().map((p) => prov.rotulo(p));
  confere("o rótulo do CLI não é uma variável de ambiente", !sem || /CLI /.test(prov.rotulo(sem)), prov.rotulo(sem || {}));
  confere("os HTTP continuam pelo nome da chave", rotulos.includes("GEMINI_API_KEY"), rotulos.join(", "));
  confere("se o CLI está armado, ele é o primeiro da fila", prov.armados()[0] ? prov.armados()[0].tipo === "cli" : true, JSON.stringify(prov.armados().map((p) => `${p.nome}:${p.tipo}`)));
}

/* 3 — o contrato de resposta é o mesmo do fetch, porque o write.js só conhece um. */
(async () => {
  console.log("3. chamar() no tipo cli — as quatro saídas possíveis");
  const p = { nome: "casca", tipo: "cli", bin: "", peso: 1 };

  const bom = casca("ok.sh", 'ENTRADA=$(cat); echo "{\\"id\\":\\"x\\",\\"stdin\\":\\"$ENTRADA\\"}"');
  let r = await prov.chamar({ ...p, bin: bom }, "plano-do-app", "PROMPT-VEIO-PELO-STDIN", 60000);
  const json = await r.json();
  const ex = prov.extrair({ ...p, bin: bom }, json);
  confere("sucesso: ok, 200 e o texto na mão de extrair()", r.ok && r.status === 200 && /"id":"x"/.test(ex.texto || ""), JSON.stringify(ex).slice(0, 120));
  confere("o prompt vai pelo stdin, não pela linha de comando", /PROMPT-VEIO-PELO-STDIN/.test(ex.texto || ""), (ex.texto || "").slice(0, 120));
  confere("a cauda de contrato (sem cercas de código) vai junto", /Responda SOMENTE com o JSON/.test(ex.texto || ""), (ex.texto || "").slice(-120));

  const vazio = casca("vazio.sh", "exit 0");
  r = await prov.chamar({ ...p, bin: vazio }, "plano-do-app", "PROMPT", 60000);
  confere("sem texto: 500, não uma resposta ok", !r.ok && r.status === 500, `${r.ok}/${r.status}`);
  confere("o motivo diz que voltou sem texto", /sem texto/.test(await r.text()), await r.text());

  const quota = casca("quota.sh", 'echo "You exceeded your quota for this plan" >&2; exit 1');
  r = await prov.chamar({ ...p, bin: quota }, "plano-do-app", "PROMPT", 60000);
  confere("cota esgotada é 429 (transitório: o write.js tenta o próximo provedor)", r.status === 429, `${r.status}: ${await r.text()}`);

  const quebrou = casca("quebrou.sh", 'echo "permission denied" >&2; exit 126');
  r = await prov.chamar({ ...p, bin: quebrou }, "plano-do-app", "PROMPT", 60000);
  confere("falha sem cara de cota é 500 e guarda a saída", r.status === 500 && /126/.test(await r.text()), await r.text());

  const dorminhoco = casca("dorme.sh", "sleep 40");
  const inicio = Date.now();
  r = await prov.chamar({ ...p, bin: dorminhoco }, "plano-do-app", "PROMPT", 1);
  const durou = Date.now() - inicio;
  confere("hang é morto no teto de parede, não espera o turno inteiro", !r.ok && durou < 40000, `${durou}ms · ${await r.text()}`);

  /* 4 — o que o app escreve é JSON puro; cercas de código são cortadas pelo
         write.js, então o transporte não pode cortá-las antes (duplo corte). */
  console.log("4. o transporte não mexe no texto");
  const cerca = casca("cerca.sh", 'echo \'```json\n{"id":"x"}\n```\'');
  r = await prov.chamar({ ...p, bin: cerca }, "plano-do-app", "PROMPT", 60000);
  const texto = (prov.extrair({ ...p, bin: cerca }, await r.json()) || {}).texto || "";
  confere("devolve a cerca como veio (quem corta é o write.js)", /^```json/.test(texto.trim()), JSON.stringify(texto.slice(0, 40)));

  /* 5 — providers.json: o HTTP continua sendo a reserva, inteira. */
  console.log("5. pipeline/providers.json");
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "providers.json"), "utf8")).provedores;
  confere("o CLI é o primeiro declarado", cfg[0].tipo === "cli", `${cfg[0].nome}/${cfg[0].tipo}`);
  confere("os HTTP de reserva não perderam chave nem endpoint", cfg.filter((x) => x.tipo !== "cli").every((x) => x.chave_env && x.endpoint), "—");
  confere("desligar o CLI é uma linha, não um patch", cfg[0].ativo === true && typeof cfg[0].ativo === "boolean", String(cfg[0].ativo));
  /* O teto padrão por chamada (2 min) foi medido com API HTTP e fila de
     modelos. O CLI recebe o prompt.md inteiro e não tem fila para alternar. */
  confere("o CLI declara teto de chamada acima dos 2 min do HTTP", Number(cfg[0].chamada_max_ms) > 120000, String(cfg[0].chamada_max_ms));

  console.log(`\n${verde} conferências verdes, ${falhas.length} vermelhas.`);
  if (falhas.length) {
    for (const f of falhas) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
})();
