/* teste-casca-resposta.js — a casca do que o modelo devolve é lida por UMA boca.

   O defeito: a linha que retira a cerca de código do JSON estava COPIADA em
   quatro lugares (`write.js` no laço principal, `write.js` na reescrita
   cirúrgica, `check-post.js` e `score.js` ao abrir o `draft.json`), e nenhuma
   das quatro era a mesma régua:

     · a cópia não tinha `i`: um ` ```JSON ` em caixa alta voltava ao
       `JSON.parse` com a palavra «JSON» na frente e estourava ali;
     · a cópia não conhecia prosa em volta do payload («Aqui está o artigo: {…}»)
       e cada chamador pesava isso de um jeito: no laço principal do `write.js`
       é veredito DEFINITIVO — com um redator armado só, a peça perdida em 0,1 s,
       a rodada vermelha e a pauta fora da fila por 24 h (`falha_texto`) por um
       defeito de FORMATAÇÃO, não de texto; no ramo cirúrgico, que cai no texto
       inteiro, o mesmo desvio era tolerado. Duas bocas, dois pesos.

   A correção é `tools/lib/resposta-json.js`, citado pelos quatro chamadores.
   Este arquivo confere (1) as formas de resposta que o módulo lê, (2) que
   nenhuma segunda boca de cerca sobrou no repo, (3) que `check-post.js` e
   `score.js` abrem um `draft.json` cercado ou com prosa e chegam ao júri em vez
   de morrer em «não é JSON válido», e (4) o que cada guarda compra — com a
   mutação no MÓDULO, não no chamador.

   Roda em CÓPIA do repo (`cp -a`) e contra fixtures escritos na própria cópia.
   Nenhuma chamada de modelo, nenhuma cota, o pipeline real não é tocado.   */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SLUG = "fixture-casca-resposta";
const FENCE = "```";

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hwp-casca-"));

/* Texto acima do piso de palavras do brief (1100 → piso 770) e uma chave com
   `}` DENTRO da string: o recorte balanceado precisa respeitar as aspas, senão
   uma matéria com «}» no corpo cortaria o JSON no meio.                    */
const ALVO = 1100;
const PISO = require(path.join(ROOT, "tools/lib/word-floor")).piso(ALVO);
const DRAFT = {
  id: SLUG,
  title: "A Fixture That Arrives Wrapped in Fences",
  dek: "Um rascunho de prova: o que importa aqui é a casca do JSON, não o texto.",
  kicker: "SCIENCE // FIXTURE",
  category: "science",
  subtopic: "space",
  author: "Dr. Aris Thorne",
  role: "Astrophysics desk",
  date: "Nov 15, 2026",
  readTime: "6 MIN READ",
  content: `<p>${"palavra ".repeat(PISO + 60).trim()}</p>`,
  sources: [{ name: "Fixture Daily", url: "https://fixture.example", claim: "nada aqui é publicável" }],
  evidence_level: "analysis_only",
  self_check: "ok",
};
const CORPO = JSON.stringify(DRAFT, null, 2);

/* As formas que um redator devolve: JSON puro é o contrato, tudo o mais é o que
   o modelo faz mesmo assim.                                              */
const FORMAS = [
  [CORPO, "inteiro", "JSON puro"],
  [FENCE + "json\n" + CORPO + "\n" + FENCE, "inteiro", "cerca minúscula"],
  [FENCE + "JSON\n" + CORPO + "\n" + FENCE, "inteiro", "cerca em CAIXA ALTA — o caso que a cópia não conhecia"],
  [FENCE + "\n" + CORPO + "\n" + FENCE, "inteiro", "cerca sem rótulo"],
  [FENCE + "json\r\n" + CORPO + "\r\n" + FENCE + "\r\n", "inteiro", "cerca com CRLF"],
  ["   \n" + FENCE + "json\n" + CORPO + "\n" + FENCE + "\n   ", "inteiro", "cerca com espaços em volta"],
  ["Aqui está o artigo:\n" + CORPO + "\nEspero que ajude!", "prosa-ao-redor", "prosa antes E depois"],
  [FENCE + "JSON\nAqui está, colega:\n" + CORPO + "\n" + FENCE, "prosa-ao-redor", "prosa dentro da cerca"],
  ['{"id":"x","content":"um } e um { dentro da string"}', "inteiro", "chave com } — a string é respeitada"],
  [CORPO, "inteiro", "a mesma corda duas vezes"],
  ["não há JSON aqui", "falhou", "prosa sem payload"],
  [CORPO.slice(0, CORPO.length - 3), "falhou", "JSON truncado NÃO é remendado"],
  ["", "falhou", "resposta vazia"],
  ["[1,2,3]", "inteiro", "lista JSON no lugar do objeto"],
];

/* grep sai 1 quando NÃO acha — para uma conferência de ausência isso é a
   resposta verde, não uma falha do comando. */
function buscaFixa(args) {
  try {
    return execFileSync("grep", args, { encoding: "utf8" });
  } catch (e) {
    if (e.status === 1 && !String(e.stderr || "").trim()) return String(e.stdout || "");
    throw e;
  }
}

function copia(mut, alvo) {  const dir = fs.mkdtempSync(path.join(tmp, "copia-")) + "/repo";
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  execFileSync("cp", ["-a", `${ROOT}/.`, `${dir}/`], { stdio: "ignore" });
  if (mut) {
    const arq = path.join(dir, alvo);
    const atual = fs.readFileSync(arq, "utf8");
    const novo = mut(atual);
    if (novo === atual) throw new Error(`a mutação não encontrou o token em ${alvo}`);
    fs.writeFileSync(arq, novo);
  }
  return dir;
}

console.log("\n1. o módulo lê as formas que os quatro chamadores recebem");
{
  const mod = require(path.join(ROOT, "tools/lib/resposta-json"));
  for (const [entrada, esperado, porque] of FORMAS) {
    const r = mod.parsear(entrada);
    const boca = r.dados ? r.boca : "falhou";
    confere(`parsear(${porque}) → ${esperado}`, boca === esperado, `boca ${boca} · ${String(r.motivo).slice(0, 60)}`);
  }
  const aspas = mod.parsear('{"id":"x","content":"um } e um { dentro da string"}');
  confere("um } dentro de string não corta o recorte", !!(aspas.dados && aspas.dados.content === "um } e um { dentro da string"), JSON.stringify(aspas.dados));
  const truncado = mod.parsear(FORMAS[11][0]);
  confere("o JSON truncado devolve o motivo do parse, não um objeto remendado", truncado.dados === null && !!truncado.motivo, truncado.motivo);
  const semCasca = mod.descascar(FENCE + "JSON\n" + CORPO + "\n" + FENCE);
  confere("descascar() devolve o corpo nu, pronto para o parse", semCasca === CORPO, semCasca.slice(0, 60));
}

console.log("\n2. doutrina: nenhuma segunda boca de cerca sobrou no repo");
{
  /* Grep em corda FIXA: o que delata uma cópia é o padrão compilado, não a
     palavra «cerca» escrita num comentário de documentação. */
  const copias = buscaFixa(["-rn", "-F", "```(?:json)", path.join(ROOT, "tools")]).split("\n").filter(Boolean);
  confere("a regex da cópia não existe em lugar nenhum de tools/", copias.length === 0, copias.join(" ⏎ ").slice(0, 300));
  const compiladores = buscaFixa(["-rl", "-F", "CERCA_INICIO", path.join(ROOT, "tools")])
    .split("\n").filter(Boolean).map((f) => path.relative(ROOT, f)).sort();
  confere("só o módulo compila a cerca", compiladores.join(",") === "tools/lib/resposta-json.js", compiladores.join(", "));
  for (const [arquivo, vezes] of [["tools/write.js", 2], ["tools/check-post.js", 1], ["tools/score.js", 1]]) {
    const fonte = fs.readFileSync(path.join(ROOT, arquivo), "utf8");
    confere(`${arquivo} cita o módulo`, /require\("\.\/lib\/resposta-json"\)/.test(fonte));
    const chamadas = (fonte.match(/respostaJson\.parsear\(/g) || []).length;
    confere(`${arquivo} abre a resposta ${vezes} vez(es)`, chamadas === vezes, `${chamadas} chamadas`);
  }
  const mod = fs.readFileSync(path.join(ROOT, "tools/lib/resposta-json.js"), "utf8");
  confere("o módulo não decide peso: devolve `motivo` e quem chama condena", !/process\.exit|definitivo|transitorio/.test(mod));
}

console.log("\n3. check-post.js e score.js abrem o rascunho cercado e chegam ao júri");
{
  const dir = copia(null);
  const d = path.join(dir, "pipeline", "drafts", SLUG);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "brief.json"), JSON.stringify({ slug: SLUG, word_count: ALVO, sources: DRAFT.sources }, null, 2) + "\n");
  fs.writeFileSync(path.join(d, "metrics.json"), JSON.stringify({ words: PISO + 60 }) + "\n");

  const CASCA = FENCE + "JSON\n" + CORPO + "\n" + FENCE;
  const PROSA = "Aqui está a matéria pedida:\n" + CORPO + "\nQualquer ajuste é só avisar.";
  for (const [bruto, porque, abre] of [
    [CORPO, "JSON puro", true],
    [CASCA, "cerca em caixa alta", true],
    [PROSA, "prosa em volta", true],
    ["nada de JSON aqui", "prosa sem payload", false],
  ]) {
    fs.writeFileSync(path.join(d, "draft.json"), bruto);
    fs.rmSync(path.join(d, "review.md"), { force: true });
    const cp = spawnSync(process.execPath, [path.join(dir, "tools", "check-post.js"), SLUG, "--offline"], { cwd: dir, encoding: "utf8", timeout: 120000 });
    const saida = `${cp.stdout || ""}${cp.stderr || ""}`;
    const revisado = fs.existsSync(path.join(d, "review.md"));
    if (abre) {
      confere(`check-post com ${porque} não morre em «não é JSON»`, !/não é JSON válido/.test(saida), saida.split("\n").slice(0, 4).join(" ⏎ "));
      confere(`check-post com ${porque} escreve o review.md do júri`, cp.status !== 2 && revisado, `exit ${cp.status}`);
      fs.rmSync(path.join(d, "score.json"), { force: true });
      const sc = spawnSync(process.execPath, [path.join(dir, "tools", "score.js"), "--draft", SLUG], { cwd: dir, encoding: "utf8", timeout: 120000 });
      const out = `${sc.stdout || ""}${sc.stderr || ""}`;
      confere(`score --draft com ${porque} calcula sem morrer no parse`, !/não é JSON válido|Unexpected token|JSON\.parse|SyntaxError/.test(out) && sc.status === 0, out.split("\n").slice(0, 4).join(" ⏎ "));
    } else {
      confere(`check-post com ${porque} recusa com a frase certa`, /não é JSON válido/.test(saida) && !revisado, saida.split("\n").slice(0, 3).join(" ⏎ "));
      const sc = spawnSync(process.execPath, [path.join(dir, "tools", "score.js"), "--draft", SLUG], { cwd: dir, encoding: "utf8", timeout: 120000 });
      confere(`score --draft com ${porque} diz o motivo em vez de estourar`, /não é JSON válido/.test(String(sc.stderr)) && sc.status === 1, `exit ${sc.status} · ${String(sc.stderr).split("\n")[0]}`);
    }
  }

  /* A marca no diário: QUAL boca leu. Sem ela «o texto veio torto» fica
     invisível e o dono julga que o redator entregou o contrato limpo. */
  fs.writeFileSync(path.join(d, "draft.json"), PROSA);
  const cp = spawnSync(process.execPath, [path.join(dir, "tools", "check-post.js"), SLUG, "--offline"], { cwd: dir, encoding: "utf8", timeout: 120000 });
  confere("o check-post avisa no stderr que leu pela prosa", /prosa-ao-redor/.test(String(cp.stderr)), String(cp.stderr).split("\n").slice(0, 3).join(" ⏎ "));
  fs.writeFileSync(path.join(d, "draft.json"), CASCA);
  const cp2 = spawnSync(process.execPath, [path.join(dir, "tools", "check-post.js"), SLUG, "--offline"], { cwd: dir, encoding: "utf8", timeout: 120000 });
  confere("com a cerca em caixa alta não há aviso: é o caminho inteiro", !/prosa-ao-redor/.test(String(cp2.stderr)), String(cp2.stderr).split("\n").slice(0, 3).join(" ⏎ "));
}

console.log("\n4. mutação no MÓDULO: o que cada guarda compra");
{
  /* M1 — arranca o recorte balanceado: a prosa em volta volta a ser «não é
     JSON», o veredito DEFINITIVO que perdia a peça em 0,1 s. */
  const dir1 = copia((f) => f.replace("const recorte = corpoJson(casca);", "const recorte = casca;"), "tools/lib/resposta-json.js");
  const mod1 = require(path.join(dir1, "tools/lib/resposta-json"));
  confere("M1: prosa em volta vira falhou", mod1.parsear("Aqui está:\n" + CORPO).dados === null);
  confere("M1: JSON puro continua inteiro", mod1.parsear(CORPO).boca === "inteiro");
  const d1 = path.join(dir1, "pipeline", "drafts", SLUG);
  fs.mkdirSync(d1, { recursive: true });
  fs.writeFileSync(path.join(d1, "brief.json"), JSON.stringify({ slug: SLUG, word_count: ALVO, sources: DRAFT.sources }, null, 2) + "\n");
  fs.writeFileSync(path.join(d1, "draft.json"), "Aqui está:\n" + CORPO);
  const cp1 = spawnSync(process.execPath, [path.join(dir1, "tools", "check-post.js"), SLUG, "--offline"], { cwd: dir1, encoding: "utf8", timeout: 120000 });
  confere("M1: o chamador quebra junto — a boca é do módulo, não do check-post", /não é JSON válido/.test(String(cp1.stderr)), String(cp1.stderr).split("\n").slice(0, 2).join(" ⏎ "));

  /* M2 — a cerca case-sensitive da cópia histórica: ` ```JSON ` sobra na corda
     e o `boca` deixa de ser «inteiro». */
  const dir2 = copia((f) => f.replace("[a-zA-Z0-9_+#.-]*", "(?:json)?"), "tools/lib/resposta-json.js");
  const mod2 = require(path.join(dir2, "tools/lib/resposta-json"));
  confere("M2: cerca em caixa alta não sai inteira (a régua da cópia velha)", mod2.parsear(FENCE + "JSON\n" + CORPO + "\n" + FENCE).boca !== "inteiro", mod2.parsear(FENCE + "JSON\n" + CORPO + "\n" + FENCE).boca);
  confere("M2: cerca minúscula continua inteira", mod2.parsear(FENCE + "json\n" + CORPO + "\n" + FENCE).boca === "inteiro");

  /* M3 — arrancar a marca de origem do `providers.chamar`: o corpo escrito por
     ESTA máquina passaria a ser indistinguível do corpo de um destino, e o
     portão do 5xx perderia o caso do binário ausente (o par deste caso está em
     `teste-redator-recusa.js`, casos 6 e 7). */
  const dir3 = copia((f) => f.replace("return { ...res, origem: \"local\" };", "return res;"), "tools/lib/providers.js");
  const sonda = (dir) =>
    spawnSync(
      process.execPath,
      ["-e", 'const p=require(process.argv[1]);p.chamar({nome:"cli",tipo:"cli",ativo:true,bin:process.argv[2]},"","x",30000).then((r)=>console.log(JSON.stringify({origem:p.origem(r),status:r.status})))', path.join(dir, "tools/lib/providers"), path.join(tmp, "bin-que-nao-existe")],
      { cwd: dir, encoding: "utf8", timeout: 60000 }
    );
  confere("M3: sem a marca, `providers.origem()` chama de remoto um corpo que foi escrito aqui", JSON.parse(sonda(dir3).stdout || "{}").origem !== "local", sonda(dir3).stdout);
  confere("no repo real a mesma resposta vem marcada como local", JSON.parse(sonda(ROOT).stdout || "{}").origem === "local", sonda(ROOT).stdout);
}

console.log("\n5. invariante: a máquina do dono não foi tocada");
{
  const gitDepois = execFileSync("git", ["-C", ROOT, "status", "--porcelain", "-uno"], { encoding: "utf8" });
  confere("o repo real está como estava", gitDepois === gitAntes, gitDepois.split("\n").join(" ⏎ "));
  confere("nenhum rascunho de fixture entrou no pipeline/drafts real", !fs.existsSync(path.join(ROOT, "pipeline", "drafts", SLUG)));
  confere("nenhum draft de fixture saiu em tools/reports", !fs.existsSync(path.join(ROOT, "tools/reports", SLUG)));
}

for (const sobra of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, sobra), { recursive: true, force: true });
fs.rmSync(tmp, { recursive: true, force: true });
confere("nenhuma cópia desta prova ficou no /tmp", !fs.existsSync(tmp), `${path.basename(tmp)} continuou no disco`);

console.log(`\n${verde} conferências verdes, ${falhas.length} vermelhas${falhas.length ? ": " + falhas.join(" | ") : ""}.`);
process.exit(falhas.length ? 1 : 0);
