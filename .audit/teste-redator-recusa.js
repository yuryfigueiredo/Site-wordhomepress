/* teste-redator-recusa.js — recusa de conexão não é "serviço ocupado".

   O defeito, lido no diário real (avisos.log 2026-11-14T20:41:28Z):
   `qoder: 1 modelo(s) ocupado(s); esperando 15s e voltando (178s nesta fatia)`
   seguido de `não saiu texto em 12min, em nenhum provedor armado`. No
   `write.js` de antes, QUALQUER exceção do `prov.chamar` virava
   `falhas.set(k, "rede: …")` + `return "transitorio"`, e a escada de espera do
   `rodar()` relê justamente o rótulo `rede:` para re-entrar o modelo na fila:
  _endpoint morto_ (app fechado, logout, conexão recusada, binário que não está
   no disco) era tratado como_serviço ocupado_ e comia a fatia inteira do
   provedor dormindo, sem nunca passar a vez ao provedor seguinte — que é a única
   coisa que resolve um destino que não responde ao SYN.

   A leitura dos tokens agora mora em UM lugar (`tools/lib/transporte.js`), a
   mesma boca do `sonda()` do pick-lead (commit c59a7f6 separou "fonte não abre"
   de "esta máquina está sem rede"; aqui é a mesma distinção na outra ponta).
   Conferência 1 é o portão anti-paralelismo: nenhuma outra boca do repo pode
   carregar a lista de tokens.

   Roda em CÓPIA do repo, com provedores de fixture: um endpoint em porta
   fechada (recusa imediata, nenhum pacote sai) e um redator de casca que devolve
   um rascunho válido. Nenhuma chave real, nenhuma cota, nenhum minuto de plano
   do app gasto.                                                            */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SLUG = "fixture-recusa-redator";
const ALVO = 1100;
const PISO = require(path.join(ROOT, "tools/lib/word-floor")).piso(ALVO);

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

const gitAntes = execFileSync("git", ["-C", ROOT, "status", "--porcelain", "-uno"], { encoding: "utf8" });
const provedoresReaisAntes = fs.readFileSync(path.join(ROOT, "pipeline/providers.json"), "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hwp-recusa-"));

/* A casca que entrega: devolve um rascunho acima do piso e conta as chamadas
   num arquivo — o contador é o que separa "passou a vez" de "dormiu e tornou".
   O nome do arquivo é o sufixo do diretório da cópia (mudança minha, medida no
   primeiro tique desta prova): com `path.basename(dir)` todas as cópias se
   chamam `repo`, um contador só servia aos três casos, e o caso 4 lia 3
   chamadas quando tinha feito uma.                                            */
const CASCA = path.join(tmp, "entrega.sh");
fs.writeFileSync(
  CASCA,
  `#!/bin/bash
cat > /dev/null
echo chamada >> "$HWP_CONT"
corpo="<p>${"x ".repeat(PISO + 40).trim()}</p>"
printf '{"id":"${SLUG}","title":"T","dek":"D","content":"%s","sources":[{"name":"Fixture Daily","url":"https://fixture.example","claim":"c"}],"self_check":"ok"}\\n' "$corpo"
`,
  { mode: 0o755 }
);

/* Porta fechada de verdade. A porta 9 NÃO serve: medido 15/11, o undici nem
   tenta — `fetch` morre em `TypeError: fetch failed ⇐ Error: bad port`, sem
   `code` em lugar nenhum, e o veredito sai `outra` (que é o que marca fila e
   cobra espera). A porta efêmera de um servidor que se escuta e se fecha dá a
   cadeia real: `⇐ Error/ECONNREFUSED::connect ECONNREFUSED 127.0.0.1:…`.
   (Pela porta de PROXY a 9 funciona, porque ali quem conecta é o conector de
   proxy, não o validador de URL — é o que o caso 6b de `teste-trava-rascunho`
   usa.)                                                                     */
const PORTA_RECUSA = Number(
  execFileSync(process.execPath, ["-e", 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close();});'], { encoding: "utf8" }).trim()
);

/* Cinturão anti-cota. `providers.localizar()` não para no `bin` declarado: se o
   arquivo não existe ele tenta `$QODER_CLI`, depois o `~/.qoder/bin/qodercli/`
   MAIS NOVO e por último o `qodercli` do PATH — ou seja, um fixture de
   "binário ausente" rodado com o ambiente tal qual levantaria o qodercli REAL
   do app e gastaria o plano dentro de uma prova. Os casos que falam de
   provedor ausente rodam com HOME num diretório vazio, PATH num diretório que
   só tem o `cat` que a casca usa, e `QODER_CLI` apagado. A conferência 4b prova
   que o cinto fecha: com esse env, localizar() devolve null.                  */
const HOME_VAZIO = path.join(tmp, "home-vazio");
const BIN_SEGURO = path.join(tmp, "bin-seguro");
fs.mkdirSync(HOME_VAZIO, { recursive: true });
fs.mkdirSync(BIN_SEGURO, { recursive: true });
const CAT = ["/bin/cat", "/usr/bin/cat"].find((c) => fs.existsSync(c));
if (CAT) fs.symlinkSync(CAT, path.join(BIN_SEGURO, "cat"));
/* O stderr comprido do F5: sessenta linhas de preâmbulo (~700 chars) e a
   digital do pacote recusado SÓ no fim — a forma banal de um CLI que reclama da
   vida antes de dizer o erro. Era aqui que o corte de 160 chars apagava o
   sintoma para quem decide se a rodada dorme ou passa a vez.                */
const RECUSA_LONGA = path.join(tmp, "recusa-longa.sh");
fs.writeFileSync(
  RECUSA_LONGA,
  `#!/bin/bash
cat > /dev/null
pre=""
for i in $(seq 1 60); do pre="$pre preambulo-do-cli-numero-$i"; done
printf '%s\\n' "$pre" >&2
echo "connect ECONNREFUSED 127.0.0.1:${PORTA_RECUSA}" >&2
exit 1
`,
  { mode: 0o755 }
);

const ENV_SEM_APP = { HOME: HOME_VAZIO, PATH: BIN_SEGURO, QODER_CLI: path.join(HOME_VAZIO, "nao-existe") };

function copia(provedores, mut) {
  const dir = fs.mkdtempSync(path.join(tmp, "copia-")) + "/repo";
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  execFileSync("cp", ["-a", `${ROOT}/.`, `${dir}/`], { stdio: "ignore" });
  fs.writeFileSync(path.join(dir, "pipeline", "providers.json"), JSON.stringify({ provedores }, null, 2) + "\n");
  const d = path.join(dir, "pipeline", "drafts", SLUG);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "prompt.md"), "CONTRATO DE FIXTURE: escreva a matéria em JSON puro.\n");
  fs.writeFileSync(path.join(d, "brief.json"), JSON.stringify({ word_count: ALVO, sources: [{ name: "Fixture Daily", url: "https://fixture.example" }] }, null, 2) + "\n");
  if (mut) {
    const arq = path.join(dir, "tools", "write.js");
    const fonte = fs.readFileSync(arq, "utf8");
    const nova = mut(fonte);
    if (nova === fonte) throw new Error("a mutação não encontrou o token em tools/write.js");
    fs.writeFileSync(arq, nova);
  }
  return dir;
}

const RECUSA = (nome) => ({ nome, tipo: "openai", ativo: true, endpoint: `http://127.0.0.1:${PORTA_RECUSA}/v1`, chave_env: "HWP_FIXTURE_KEY", fila: ["fantasma-1", "fantasma-2"], peso: 1 });
const ENTREGA = { nome: "casca", tipo: "cli", ativo: true, bin: CASCA, fila: ["Fix"], chamada_max_ms: 30000, peso: 3 };
const SEM_BIN = { nome: "sem-binario", tipo: "cli", ativo: true, bin: path.join(tmp, "nao-existe-que-roda-ninguem"), fila: ["Fix"], peso: 1 };
const RECUSA_FUNDO = { nome: "recusa-fundo", tipo: "cli", ativo: true, bin: RECUSA_LONGA, fila: ["Fix"], peso: 1 };

function roda(dir, minutos, semApp) {
  const cont = path.join(tmp, `cont-${path.basename(path.dirname(dir))}`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, "tools", "write.js"), SLUG], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120000,
    env: {
      ...process.env,
      HWP_FIXTURE_KEY: "chave-de-fixture",
      HWP_CONT: cont,
      WRITE_MINUTES: String(minutos || 4),
      ...(semApp ? ENV_SEM_APP : {}),
    },
  });
  return {
    code: r.status ?? -1,
    out: String(r.stdout || ""),
    err: String(r.stderr || ""),
    chamadas: fs.existsSync(cont) ? fs.readFileSync(cont, "utf8").split("\n").filter(Boolean).length : 0,
    segundos: (Date.now() - t0) / 1000,
    rascunho: dir,
  };
}

console.log("\n1. a lista de tokens de transporte tem UMA boca no repo");
{
  /* O grep é em corda FIXA e com as barras de alternância dentro: os tokens
     sozinhos aparecem em comentário de documentação (o `pick-lead.js` descreve
     os três vereditos em prosa), e uma conferência que confunde prosa com
     implementação acusaria o repo inteiro de paralelismo. O que delata uma
     segunda IMPLEMENTAÇÃO é a lista compilada, com os pipes. */
  const arquivos = execFileSync("grep", ["-rl", "-F", "ENOTFOUND|EAI_AGAIN|ECONNREFUSED", path.join(ROOT, "tools")], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .map((f) => path.relative(ROOT, f))
    .sort();
  confere("só tools/lib/transporte.js compila a lista", arquivos.join(",") === "tools/lib/transporte.js", arquivos.join(", "));
  const transporte = require(path.join(ROOT, "tools/lib/transporte"));
  const TABELA = [
    [{ name: "TypeError", cause: { code: "ECONNREFUSED" }, message: "fetch failed" }, "sem-rede", "porta fechada"],
    [{ name: "Error", code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND api.exemplo" }, "sem-rede", "DNS morto"],
    [{ name: "Error", message: "connect ECONNRESET 10.0.0.1:443" }, "sem-rede", "conexão resetada"],
    [{ name: "TypeError", message: "fetch failed", cause: { message: "connect ECONNREFUSED 127.0.0.1:44444" } }, "sem-rede", "token SÓ no cause.message: a cadeia é descida"],
    [{ name: "TimeoutError", code: 23, message: "The operation was aborted due to timeout" }, "empacou", "AbortSignal com code NÚMERO"],
    [{ message: "o binário /caminho/qodercli não está no disco" }, "outra", "fato de máquina NÃO é sintoma de pacote — saiu de SEM_REDE"],
    ["HTTP 500: servidor ocupado", "outra", "5xx com corpo é do destino"],
    ["timeout de 30s no CLI", "outra", "corte de parede NÃO é recusa: continua transitório"],
  ];
  for (const [alvo, esperado, porque] of TABELA) confere(`classe(${porque}) = ${esperado}`, transporte.classe(alvo) === esperado, transporte.classe(alvo));
  /* O portão do 5xx, na boca única: «esperar isto cura alguma coisa?» depende
     de QUEM escreveu o corpo, não do que ele contém. Medido 15/11 08:47: com o
     token lido do corpo de um destino, um provedor vivo era abandonado em 0,1 s. */
  const CURA = [
    ["local", "o binário /caminho/qodercli não está no disco", false, "binário ausente: espera não cura"],
    ["local", "o CLI não levantou: spawn EACCES", false, "spawn morto: espera não cura"],
    ["local", "connect ECONNREFUSED 127.0.0.1:44444", false, "stderr do filho é fato daqui"],
    ["local", "timeout de 30s no CLI", true, "corte de parede: pode ser só carga"],
    ["remoto", "getaddrinfo failed para api.interna.exemplo", true, "prosa do DESTINO sobre a rede DELE"],
    ["remoto", "upstream busy", true, "500 comum: espera é a resposta"],
  ];
  for (const [origem, corpo, esperado, porque] of CURA)
    confere(`esperaCura(${origem}, «${corpo.slice(0, 24)}…») = ${esperado} — ${porque}`, transporte.esperaCura(origem, corpo) === esperado, transporte.esperaCura(origem, corpo));
  confere("o write.js lê a decisão do módulo, não uma regex própria", /transporte\.esperaCura\(prov\.origem\(res\), txt\)/.test(fs.readFileSync(path.join(ROOT, "tools/write.js"), "utf8")));
  /* A corda que o classificador lê não é a corda que o diário imprime. Medido
     15/11 pelo revisor (F5): com `prov.reason(txt)` na linha de decisão, um
     `ECONNREFUSED` empurrado ~443 chars para dentro do stderr saía do corte de
     160, virava `outra` e pagava a escada de 15→30→90 s sobre um destino que já
     tinha recusado — o defeito que o commit declarou morto, vivo pelo tamanho. */
  const wDecisao = fs.readFileSync(path.join(ROOT, "tools/write.js"), "utf8");
  confere("a decisão lê o corpo inteiro; o corte de 160 chars fica só na frase do diário", !/esperaCura\(prov\.origem\(res\), porQue\)/.test(wDecisao) && /esperaCura\(prov\.origem\(res\), txt\)/.test(wDecisao));
  confere("e a frase do recusado local vem do módulo (`inalcançável`), não do rótulo HTTP com o preâmbulo", /transporte\.semRede\(txt\)/.test(wDecisao) && /inalcançável: \$\{transporte\.motivo\(txt\)/.test(wDecisao));
  confere("e o `motivo` do CLI chega sem corte ao reador (a fatia é do stderr acumulado, não da decisão)", !/saiu com \$\{código\}: \$\{\(erro \|\| saida\)\.trim\(\)\.slice/.test(fs.readFileSync(path.join(ROOT, "tools/lib/providers.js"), "utf8")));
  const bocaOrigem = fs.readFileSync(path.join(ROOT, "tools/lib/providers.js"), "utf8");
  const declaração = (bocaOrigem.match(/module\.exports = \{[^}]*\};/) || [""])[0];
  confere("e `origem()` é uma boca só: providers exporta, ninguém inspeciona o campo cru", /\borigem\b/.test(declaração) && !/res\.origem\b/.test(fs.readFileSync(path.join(ROOT, "tools/write.js"), "utf8")), declaração.trim() || "nenhum `module.exports = { … }` encontrado");
  const pick = fs.readFileSync(path.join(ROOT, "tools/pick-lead.js"), "utf8");
  confere("o pick-lead cita o módulo e não testa token nenhum", /require\("\.\/lib\/transporte"\)/.test(pick) && !/test\(sinal\)/.test(pick));
  const w = fs.readFileSync(path.join(ROOT, "tools/write.js"), "utf8");
  confere("o write.js cita o módulo e não testa token nenhum", /require\("\.\/lib\/transporte"\)/.test(w) && !/(SEM_REDE|EMPACA)\b/.test(w) && !/test\(sinal\)/.test(w));
}

console.log("\n2. endpoint que recusa a conexão: passa a vez, não dorme, e o provedor seguinte entrega");
{
  const dir = copia([RECUSA("recusa"), ENTREGA]);
  const r = roda(dir);
  confere("a peça saiu pelo provedor seguinte", r.code === 0 && r.chamadas === 1, `codigo ${r.code}, ${r.chamadas} chamada(s) na casca · ${r.err.slice(-200)}`);
  confere("nenhuma escada de espera em cima de recusa", !/esperando \d+s/.test(r.err), r.err.split("\n").filter((l) => /esperando/.test(l)).join(" ⏎ "));
  confere("e a fatia do recusado foi gasta em segundos, não em dormir", r.segundos < 10, `${r.segundos.toFixed(1)}s`);
}

console.log("\n2b. sem provedor seguinte, a causa que o diário mostra é `inalcançável`, não `ocupado`");
{
  /* O mapa `falhas` só é despejado no stderr quando nenhuma texto saiu
     (write.js:400), então este caso fecha o round com o recusado sozinho: é
     exatamente a leitura que o dono teria do `TURNO.md`. */
  const dir = copia([RECUSA("recusa")]);
  const r = roda(dir);
  confere("a rodada fecha sem texto", r.code !== 0, `codigo ${r.code}`);
  confere("o veredito diz inalcansável, não ocupado", /inalcançável/.test(r.err) && !/ocupado\(s\)/.test(r.err), r.err.split("\n").filter((l) => /·/.test(l)).join(" ⏎ "));
  confere("e o modelo recusado não volta para a fila", !/esperando \d+s/.test(r.err), r.err.slice(-200));
}

console.log("\n2c. o token no FUNDO de um stderr comprido: a decisão lê a corda inteira, não os 160 chars do diário");
{
  /* F5, medido 15/11 pelo revisor nas duas árvores vivas: o MESMO
     `ECONNREFUSED` no começo da corda dava `definitivo` em 0,2 s; empurrado
     ~443 chars para dentro — a forma banal de um CLI que despeja preâmbulo
     antes do erro — saía do `reason(txt)` de 160, virava `outra`, e a escada de
     15→30→90 s reacendia sobre um destino que já tinha recusado o SYN. A
     falsificação não mexe no `transporte` nem no `reason()`: devolve o corte
     para a LINHA DE DECISÃO, que é o erro.                                 */
  const dir = copia([RECUSA_FUNDO, ENTREGA]);
  const r = roda(dir);
  confere("recusa enterrada no preâmbulo passa a vez, não dorme", !/esperando \d+s/.test(r.err), r.err.split("\n").filter((l) => /esperando|inalcan|recusa/.test(l)).join(" ⏎ ").slice(0, 300));
  confere("e a peça sai do provedor seguinte em segundos", r.code === 0 && r.chamadas === 1 && r.segundos < 15, `codigo ${r.code}, ${r.chamadas} chamada(s), ${r.segundos.toFixed(1)}s`);
  /* Sozinho, sem provedor seguinte: é a única forma de ver a frase que o dono
     leria no `TURNO.md`. Ela tem de dizer o FATO (recusa, não ocupado) e caber
     no corte — os ~700 chars de preâmbulo não podem chegar ao diário.        */
  const solo = roda(copia([RECUSA_FUNDO]));
  const linha = (solo.err.match(/recusa-fundo[^\n]*/) || [""])[0];
  confere("com o recusado sozinho a rodada fecha sem texto", solo.code !== 0, `codigo ${solo.code}`);
  confere("a frase diz inalcansável, não HTTP 500 com preâmbulo", /inalcançável/.test(solo.err) && !/ocupado\(s\)/.test(solo.err), linha.slice(0, 160));
  confere("e continua curta: o corte é da frase, não da decisão", linha.length > 0 && linha.length < 240, `${linha.length} chars`);
  const mut = copia([RECUSA_FUNDO, ENTREGA], (fonte) => fonte.replace("transporte.esperaCura(prov.origem(res), txt)", "transporte.esperaCura(prov.origem(res), porQue)"));
  const m = roda(mut, 1);
  confere("a mutação devolve mesmo o corte à linha de decisão", fs.readFileSync(path.join(mut, "tools/write.js"), "utf8").includes("esperaCura(prov.origem(res), porQue)"));
  confere("com o corte de volta a escada reacende em cima do recusado", /esperando \d+s/.test(m.err), m.err.split("\n").filter((l) => /esperando/.test(l)).join(" ⏎ ").slice(0, 240));
  confere("e o custo é mensurável no relógio da prova", m.segundos > 15, `${m.segundos.toFixed(1)}s`);
}

console.log("\n3. falsificação: voltar o genérico `rede:` reacende a escada que come a fatia");
{
  const dir = copia([RECUSA("recusa"), ENTREGA], (fonte) => fonte.replace('if (natureza === "sem-rede") {', "if (false) {"));
  confere("a mutação encontrou o portão", fs.readFileSync(path.join(dir, "tools/write.js"), "utf8").includes("if (false) {"));
  const r = roda(dir);
  confere("com o portão arrancado o write.js dorme no destino morto", /esperando \d+s/.test(r.err), r.err.split("\n").filter((l) => /esperando|inalcan/.test(l)).join(" ⏎ "));
  confere("e a espera é mensurável no relógio da prova", r.segundos > 10, `${r.segundos.toFixed(1)}s`);
  confere("a peça ainda chega, atrasada — é o custo de 15-90s por horário", r.code === 0 && r.chamadas === 1, `codigo ${r.code}`);
}

console.log("\n4. binário ausente é inerte, e nunca cai no qodercli real do app");
{
  /* Com o cinto de env, o provedor `cli` sem binário não entra na fila: ele é
     `desarmado`, então nenhuma chamada sai — e o plano do app não é gasto por
     uma prova. Sem o cinto, `localizar()` acharia o binário real. */
  const dir = copia([SEM_BIN, ENTREGA]);
  const r = roda(dir, 4, true);
  confere("o provedor sem binário não é reentrado", !/esperando \d+s/.test(r.err), r.err.slice(-260));
  confere("a casca entrega a peça, uma chamada só", r.code === 0 && r.chamadas === 1, `codigo ${r.code}, ${r.chamadas} chamada(s) · ${r.err.slice(-200)}`);
  confere("a entrega sai em segundos, não na fatia do ausente", r.segundos < 30, `${r.segundos.toFixed(1)}s`);
  const inerte = spawnSync(process.execPath, ["-e", 'const p=require(process.argv[1]);console.log(JSON.stringify(p.localizar({bin_nome:"qodercli"})))', path.join(dir, "tools/lib/providers")], {
    cwd: dir, encoding: "utf8", timeout: 30000, env: { ...process.env, ...ENV_SEM_APP },
  });
  confere("com HOME e PATH fechados, localizar() não acha binário nenhum", JSON.parse(inerte.stdout || "null") === null, inerte.stdout);
  const semCinto = spawnSync(process.execPath, ["-e", 'const p=require(process.argv[1]);console.log(JSON.stringify(p.localizar({bin_nome:"qodercli"})))', path.join(dir, "tools/lib/providers")], {
    cwd: dir, encoding: "utf8", timeout: 30000,
  });
  confere("nesta máquina há qodercli real: sem o cinto a prova o chamaria", typeof JSON.parse(semCinto.stdout || "null") === "string", semCinto.stdout);
}

console.log("\n5. invariante: a máquina do dono não foi tocada");
{
  const gitDepois = execFileSync("git", ["-C", ROOT, "status", "--porcelain", "-uno"], { encoding: "utf8" });
  confere("o repo real está como estava", gitDepois === gitAntes, gitDepois.split("\n").join(" ⏎ "));
  confere("nenhum rascunho de fixture entrou no pipeline/drafts real", !fs.existsSync(path.join(ROOT, "pipeline/drafts", SLUG)));
  confere("o pipeline/providers.json real está byte a byte como estava", fs.readFileSync(path.join(ROOT, "pipeline/providers.json"), "utf8") === provedoresReaisAntes, "foi tocado");
  confere("nenhum fixture escreveu no providers.json real", !fs.readFileSync(path.join(ROOT, "pipeline/providers.json"), "utf8").includes("127.0.0.1"), "apareceu endpoint de fixture");
  for (const sobra of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, sobra), { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  confere("nenhuma cópia desta prova ficou no /tmp", !fs.existsSync(tmp), `${path.basename(tmp)} continuou no disco`);
}

console.log(`\n${verde} conferências verdes, ${falhas.length} vermelhas${falhas.length ? ": " + falhas.join(" | ") : ""}.`);
process.exit(falhas.length ? 1 : 0);
