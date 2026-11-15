/* teste-ritmo-uma-segmentacao.js — o gate de ritmo mede FRASES, não títulos
   colados na frase seguinte.

   O defeito, medido nesta máquina: `check-post.js` tinha DUAS segmentações de
   frase convivendo. As quatro réguas de parágrafo (`paragraphs`, cortado em
   `</p>`, `</li>`, `</h2>`, `</h3>`, `</blockquote>`) e a medição de
   `shortest`/`longest`/abertura/fecho/repetição, que saía de
   `sentences(stripTags(html))` — o texto inteiro, com as tags trocadas por
   espaço. Um `<h2>` sem ponto final colava-se na primeira frase do parágrafo
   seguinte e virava uma "frase" só. No acervo publicado, 13 de 37 peças medem
   diferente pelas duas bocas, com Δ de até 9 palavras. E foi assim que a rodada
   das 02:23 de 15/11 reprovou um texto de 1146 palavras com "frase com 33
   palavras": eram 7 palavras de título + 26 de frase. A reescrita que esse
   conserto de uma linha puxou estourou os 780 s do `chamada_max_ms` e a rodada
   morreu sem peça.

   Este arquivo roda o VERDADEIRO `tools/check-post.js` numa cópia do repo em
   /tmp e confere o número medido (`metrics.json`) e a linha de reprovação, não a
   opinião do teste. A falsificação (caso 4) devolve a segunda segmentação na
   cópia e exige que o título volte a engordar a frase. O caso 5 é o sentido
   contrário: com uma boca só, a repetição de frase fica MAIS visível, não menos. */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SLUG = "fixture-ritmo-uma-segmentacao";
const TITULO = "What a summary sentence does not settle";
const FRASE26 = "Which star, which instrument mode, which reduction pipeline: a one-line summary answers none of them, and this desk could not retrieve the release text to check.";
const FRASE_LONGA = "Which star, which instrument mode, which reduction pipeline and which archive release: a one-line summary answers none of them at all, and this desk could not retrieve the release text to check.";

const conta = (s) => s.trim().split(/\s+/).filter(Boolean).length;

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hwp-ritmo-"));

/* Os fixtures abaixo são conferidos no texto real que o modelo devolve: um
   parágrafo de abertura, um `<h2>` sem ponto final e o parágrafo que vem
   depois. As outras réguas de ritmo (parágrafo de uma frase, parágrafo longo)
   são satisfeitas de propósito para a linha `[rhythm]` que aparece ser só a de
   comprimento — se aparecer outra, o caso confere e acusa na mesma. */
function corpo(blocos) {
  return `<p>${"The frames were taken twice, and the reduction changed nothing else. ".repeat(1)}It is a plain statement of the arithmetic.</p>
<h2>${TITULO}</h2>
<p>${blocos}</p>
<p>Say it plainly. Writing around it is worse. The object is unknown here. A piece that guessed would mislead the reader.</p>`;
}

function fixture(html) {
  const dir = fs.mkdtempSync(path.join(tmp, "copia-")) + "/repo";
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  execFileSync("cp", ["-a", `${ROOT}/.`, `${dir}/`], { stdio: "ignore" });
  const d = path.join(dir, "pipeline", "drafts", SLUG);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(d, "draft.json"),
    JSON.stringify({
      id: SLUG,
      title: "A summary sentence is not a measurement",
      dek: "Uma frase de 26 palavras não vira de 33 por causa do título.",
      date: "Nov 15, 2026",
      sources: [{ name: "Fixture Daily", url: "https://fixture.example/ritmo", claim: "a medição" }],
      content: html,
      self_check: {},
    }, null, 2) + "\n"
  );
  return { dir, d };
}

function roda(fx, rotulo) {
  let out = "";
  let code = 0;
  try {
    out = execFileSync(process.execPath, [path.join(fx.dir, "tools", "check-post.js"), SLUG, "--offline"], {
      cwd: fx.dir, stdio: "pipe", timeout: 120000, encoding: "utf8",
    });
  } catch (err) {
    code = err.status === undefined ? -1 : err.status;
    out = String(err.stdout || "") + String(err.stderr || "");
  }
  const metrics = JSON.parse(fs.readFileSync(path.join(fx.d, "metrics.json"), "utf8"));
  return { out, code, metrics, texto: fs.readFileSync(path.join(fx.d, "review.md"), "utf8") };
}

console.log(`1. título de ${conta(TITULO)} palavras + frase de ${conta(FRASE26)} (a forma exata da rodada das 02:23 de 15/11)`);
{
  const fx = fixture(corpo(FRASE26));
  const r = roda(fx, "merge");
  confere(`a frase mais longa medida é a frase de verdade (${conta(FRASE26)}), não título+frase (${conta(TITULO) + conta(FRASE26)})`, r.metrics.longest_sentence_words === conta(FRASE26), `veio ${r.metrics.longest_sentence_words}`);
  confere("nenhuma reprovação de comprimento no texto", !/frase com \d+ palavras/.test(r.out), (r.out.match(/frase com [^\n]*/) || ["nenhuma"])[0]);
  confere("e a métrica vai ao review com o mesmo número", r.texto.includes(`mais longa ${conta(FRASE26)}`), (r.texto.match(/mais longa \d+/) || ["ausente"])[0]);
}

console.log(`\n2. frase de ${conta(FRASE_LONGA)} palavras DENTRO de um parágrafo: a régua continua dura`);
{
  const fx = fixture(corpo(FRASE_LONGA));
  const r = roda(fx, "longa");
  confere(`a mais longa é ${conta(FRASE_LONGA)}`, r.metrics.longest_sentence_words === conta(FRASE_LONGA), `veio ${r.metrics.longest_sentence_words}`);
  confere(`reprova com "frase com ${conta(FRASE_LONGA)} palavras (máximo 30)"`, new RegExp(`frase com ${conta(FRASE_LONGA)} palavras \\(máximo 30\\)`).test(r.out), (r.out.match(/frase com [^\n]*/) || ["nenhuma"])[0]);
  confere("e sai reprovado mesmo offline", r.code !== 0, `exit ${r.code}`);
}

console.log("\n3. o número que o review mede é o mesmo que a regra usa (uma boca, não duas)");
{
  const fx = fixture(corpo(FRASE26));
  const r = roda(fx, "boca-unica");
  const noReview = Number((r.texto.match(/mais longa (\d+)/) || [])[1]);
  confere("review e métrica concordam", noReview === r.metrics.longest_sentence_words, `review ${noReview} × métrica ${r.metrics.longest_sentence_words}`);
  /* A régua é conferida na forma que o gate usa: frases DENTRO de cada bloco.
    Contar no texto inteiro descascado (o caminho mutado do caso 4) acharia as
    mesmas 33 palavras fantasma — a asserção estaria medindo o defeito. */
  const piorBloco = Math.max(...corpo(FRASE26).split(/<\/(?:p|li|h2|h3|blockquote)>/i)
    .flatMap((b) => (b.replace(/<[^>]+>/g, " ").match(/[^.!?]+[.!?]+/g) || []).map((s) => conta(s))));
  confere("nenhum bloco do fixture tem frase acima de 30 palavras", piorBloco <= 30, `veio ${piorBloco}`);
}

console.log("\n4. falsificação: devolver a segunda segmentação (a medida no texto inteiro)");
{
  const fx = fixture(corpo(FRASE26));
  const arq = path.join(fx.dir, "tools", "check-post.js");
  const fonte = fs.readFileSync(arq, "utf8");
  confere("a cópia tem uma segmentação só para ser mutada", fonte.includes("paras.flatMap((p) => sentences(p))"), fonte.match(/const sents = [^\n]*/)?.[0] || "token ausente");
  fs.writeFileSync(arq, fonte.replace("paras.flatMap((p) => sentences(p))", "sentences(text)"));
  const r = roda(fx, "duas-bocas");
  confere(`com a medida no texto inteiro, o título volta a engordar a frase (${conta(TITULO) + conta(FRASE26)})`, r.metrics.longest_sentence_words === conta(TITULO) + conta(FRASE26), `veio ${r.metrics.longest_sentence_words}`);
  confere("e a reprovação fantasma reaparece", new RegExp(`frase com ${conta(TITULO) + conta(FRASE26)} palavras`).test(r.out), (r.out.match(/frase com [^\n]*/) || ["nenhuma"])[0]);
}

console.log("\n5. sentido contrário: com uma boca só, a frase repetida depois de títulos DIFERENTES deixa de escapar");
{
  const repetida = "The archive was released in November and nobody re-ran the pipeline.";
  const html = `<p>${repetida}</p><h2>Primeiro título</h2><p>${repetida} Say it plainly. Writing around it is worse. The object is unknown here. A piece that guessed would mislead the reader.</p>`;
  const fx = fixture(html);
  const r = roda(fx, "repetida");
  confere("a repetição é pega", /frase repetida 2x/.test(r.out), (r.out.match(/frase repetida [^\n]*/) || ["nenhuma"])[0]);
  /* A mutação do caso 4 é a prova de que isto não é sorte: com as duas bocas, as
     duas ocorrências têm chaves diferentes (cada uma colada num título) e o
     detector não vê nada. */
  const arq = path.join(fx.dir, "tools", "check-post.js");
  const fonte = fs.readFileSync(arq, "utf8");
  fs.writeFileSync(arq, fonte.replace("paras.flatMap((p) => sentences(p))", "sentences(text)"));
  const velho = roda(fx, "repetida-duas-bocas");
  confere("com a medida velha, a MESMA repetição passava verde", !/frase repetida/.test(velho.out), (velho.out.match(/frase repetida [^\n]*/) || ["nenhuma"])[0]);
}

console.log("\n6. invariante: a máquina do dono não foi tocada");
{
  const gitDepois = execFileSync("git", ["-C", ROOT, "status", "--porcelain", "-uno"], { encoding: "utf8" });
  confere("o repo real está como estava", gitDepois === gitAntes, gitDepois.split("\n").join(" ⏎ "));
  confere("nenhum rascunho de fixture entrou no pipeline/drafts real", !fs.existsSync(path.join(ROOT, "pipeline", "drafts", SLUG)), "diretório de fixture apareceu no repo");
  confere("o check-post real continua com uma segmentação só", fs.readFileSync(path.join(ROOT, "tools", "check-post.js"), "utf8").includes("paras.flatMap((p) => sentences(p))"));
}

for (const sobra of fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith("hwp-ritmo-"))) {
  fs.rmSync(path.join(os.tmpdir(), sobra), { recursive: true, force: true });
}

console.log(`\n${verde} conferências verdes, ${falhas.length} vermelhas${falhas.length ? ": " + falhas.join(" | ") : ""}.`);
process.exit(falhas.length ? 1 : 0);
