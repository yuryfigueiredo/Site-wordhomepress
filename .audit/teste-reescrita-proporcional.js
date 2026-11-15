/* teste-reescrita-proporcional.js — prova de que a reescrita pede o conserto,
   não um romance novo.

   O defeito, medido nesta máquina na rodada das 02:23 de 15/11: o redator
   entregou 1146 palavras (piso 770), o check-post reprovou UMA frase de 33
   palavras, e o prompt de reescrita mandava "Mantenha os parágrafos que o
   editor não reprovou e ACRESCENTE seções até passar de 770 palavras" — uma
   ordem já cumprida, colada em cima de um conserto de uma linha. A chamada
   devolveu o JSON inteiro reescrito, passou dos 780 s do `chamada_max_ms` sem
   fechar, e a rodada morreu sem peça. Duas ordens paralelas no mesmo prompt
   (corrigir e expandir) é a mesma família de defeito que o repo combate em
   cover-rules/picks-rules: a régua tem uma boca, e aqui ela depende do que
   falta.

   Este arquivo roda o VERDADEIRO `tools/write.js` numa cópia do repo em /tmp,
   com o provedor trocado por um `cli` de casca que grava em disco o prompt que
   recebeu e devolve nada. O que se confere é o prompt montado pelo write.js —
   não a resposta do modelo, que não existe aqui. A falsificação (última seção)
   reintroduz a ordem única na cópia e exige que o pedido de expansão volte a
   aparecer num rascunho que já passou do piso.                                              */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SLUG = "fixture-reescrita-proporcional";
const ALVO = 1100;
const PISO = Math.round(ALVO * 0.7);

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hwp-reescrita-"));

/* A casca é o provedor: engole o prompt pelo stdin, grava no caminho que o
   caso pede, e devolve um JSON sem rascunho — o write.js registra a falha e
   sai 1, que é o caminho curto para a conferência. Nada de rede, nada de
   cota: o tempo total desta prova é de segundos. */
const CASCA = path.join(tmp, "redator.sh");
fs.writeFileSync(CASCA, `#!/bin/bash\ncat > "$HWP_CASCA_CAPTURE"\necho '{"ok":true}'\n`, { mode: 0o755 });

function fixture() {
  /* Uma cópia por caso: as quatro situações trocam só o rascunho plantado, e um
     draft.json que vazasse de um caso para o outro conferiria a instrução errada
     com a roupa da certa. */
  const dir = fs.mkdtempSync(path.join(tmp, "copia-")) + "/repo";
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  execFileSync("cp", ["-a", `${ROOT}/.`, `${dir}/`], { stdio: "ignore" });
  fs.writeFileSync(
    path.join(dir, "pipeline", "providers.json"),
    JSON.stringify({ provedores: [{ nome: "fixture", tipo: "cli", ativo: true, bin: CASCA, fila: ["Fix"], chamada_max_ms: 30000 }] }, null, 2) + "\n"
  );
  const d = path.join(dir, "pipeline", "drafts", SLUG);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "prompt.md"), "CONTRATO DE FIXTURE: escreva a matéria em JSON puro.\n");
  fs.writeFileSync(path.join(d, "brief.json"), JSON.stringify({ word_count: ALVO, sources: [{ name: "Fixture Daily", url: "https://fixture.example" }] }, null, 2) + "\n");
  fs.writeFileSync(path.join(d, "fix.md"), "O editor mecânico reprovou seu draft. Corrija EXATAMENTE estes pontos e devolva o JSON completo de novo:\n  ✗ [rhythm] frase com 33 palavras (máximo 30)\nNão mude o que já estava aprovado.\n");
  return { dir, drafts: d };
}

/* `contar` do write.js arranca as tags e divide por espaço: palavras "x" é a
   maneira exata de plantar um rascunho de N palavras sem depender de texto. */
function plantaTexto(fx, palavras) {
  fs.writeFileSync(
    path.join(fx.drafts, "draft.json"),
    JSON.stringify({ id: SLUG, title: "Título de fixture", dek: "Dek.", content: `<p>${"x ".repeat(palavras).trim()}</p>`, sources: [] }, null, 2) + "\n"
  );
}

function captura(fx, rotulo) {
  const arquivo = path.join(tmp, `prompt-${rotulo}.txt`);
  try {
    execFileSync(process.execPath, [path.join(fx.dir, "tools", "write.js"), SLUG], {
      cwd: fx.dir,
      stdio: "pipe",
      timeout: 120000,
      env: { ...process.env, HWP_CASCA_CAPTURE: arquivo },
    });
  } catch (err) {
    /* O exit 1 é esperado: a casca não devolve rascunho. O que interessa é o
       prompt que ficou no disco. */
    if (!fs.existsSync(arquivo)) throw err;
  }
  return fs.readFileSync(arquivo, "utf8");
}

console.log(`1. rascunho de 1146 palavras contra o piso ${PISO} (a forma exata da rodada das 02:23 de 15/11)`);
{
  const fx = fixture();
  plantaTexto(fx, 1146);
  const p = captura(fx, "acima");
  confere("o write.js recebeu o prompt", p.includes("CONTRATO DE FIXTURE"), p.slice(0, 120));
  confere(`o texto atual vai no prompt com a conta medida (${PISO} é o piso)`, new RegExp(`SEU TEXTO ATUAL \\(1146 palavras; o piso é ${PISO}\\)`).test(p), (p.match(/SEU TEXTO ATUAL[^\n]*/) || ["ausente"])[0]);
  confere("a devolutiva do editor está lá", /\[rhythm\] frase com 33 palavras/.test(p), (p.match(/rhythm[^\n]*/) || ["ausente"])[0]);
  confere("a ordem é de conserto: NÃO acrescente seções", /NÃO reescreva do zero e NÃO acrescente seções/.test(p), (p.slice(-400)).replace(/\n/g, " ⏎ "));
  confere("a ordem de expansão sumiu do prompt de um texto que já passou do piso", !/ACRESCENTE seções/.test(p), (p.match(/ACRESCENTE[^\n]*/) || ["nenhuma"])[0]);
  confere("e o mesmo JSON, com o mesmo comprimento, é o que se pede", /mesmo comprimento/.test(p), (p.slice(-260)).replace(/\n/g, " ⏎ "));
}

console.log("\n2. rascunho de 600 palavras, abaixo do piso: expandir continua sendo a ordem");
{
  const fx = fixture();
  plantaTexto(fx, 600);
  const p = captura(fx, "abaixo");
  confere(`pede ACRESCENTE seções até passar de ${PISO}`, new RegExp(`ACRESCENTE seções até passar de ${PISO} palavras`).test(p), (p.match(/ACRESCENTE[^\n]*/) || ["ausente"])[0]);
  confere("não manda manter o comprimento", !/NÃO acrescente seções/.test(p), (p.slice(-260)).replace(/\n/g, " ⏎ "));
  confere("a conta mostrada no prompt é a do rascunho plantado", new RegExp(`SEU TEXTO ATUAL \\(600 palavras; o piso é ${PISO}\\)`).test(p), (p.match(/SEU TEXTO ATUAL[^\n]*/) || ["ausente"])[0]);
}

console.log("\n3. sem rascunho anterior (reescrita com o texto perdido): só a devolutiva, nenhuma das duas ordens");
{
  const fx = fixture();
  const p = captura(fx, "vazio");
  confere("a devolutiva do editor continua no prompt", /\[rhythm\] frase com 33 palavras/.test(p), (p.match(/rhythm[^\n]*/) || ["ausente"])[0]);
  confere("não há bloco de texto atual", !/SEU TEXTO ATUAL/.test(p), "bloco presente");
  confere("nem ordem de expansão", !/ACRESCENTE seções/.test(p), "ordem presente");
}

console.log("\n4. falsificação: a ordem única de antes, colada de volta na cópia");
{
  const fx = fixture();
  plantaTexto(fx, 1146);
  const arq = path.join(fx.dir, "tools", "write.js");
  const fonte = fs.readFileSync(arq, "utf8");
  /* Um token, não um bloco: a mutação tem de ser legível e não pode depender
     de como o ternário quebrou linha. `1 < 2` força o ramo de expansão em
     qualquer comprimento — que é exatamente a ordem única de antes. */
  confere("a cópia tem a conta de comprimento para ser mutada", fonte.includes("n < piso"), fonte.match(/.{0,40}piso.{0,40}/) ? "contada, token ausente" : "trecho não lido");
  const mutado = fonte.replace("n < piso", "1 < 2");
  confere("a mutação pegou no arquivo", mutado !== fonte && mutado.includes("1 < 2"), "nada foi trocado");
  fs.writeFileSync(arq, mutado);
  const p = captura(fx, "mutado");
  confere("com a ordem única, o rascunho de 1146 palavras volta a receber 'ACRESCENTE seções'", /ACRESCENTE seções/.test(p), (p.match(/ACRESCENTE[^\n]*/) || ["ausente"])[0]);
  confere("e perde o pedido de conserto proporcional", !/NÃO reescreva do zero e NÃO acrescente seções/.test(p), (p.slice(-260)).replace(/\n/g, " ⏎ "));
}

console.log("\n5. invariante: a máquina do dono não foi tocada");
{
  const gitDepois = execFileSync("git", ["-C", ROOT, "status", "--porcelain", "-uno"], { encoding: "utf8" });
  confere("o repo real está como estava", gitDepois === gitAntes, gitDepois.split("\n").join(" ⏎ "));
  confere("o providers.json real continua com o qoder em primeiro lugar", JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "providers.json"), "utf8")).provedores[0].nome === "qoder");
  confere("nenhum rascunho de fixture entrou no pipeline/drafts real", !fs.existsSync(path.join(ROOT, "pipeline", "drafts", SLUG)), "diretório de fixture apareceu no repo");
}

for (const sobra of fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith("hwp-reescrita-"))) {
  fs.rmSync(path.join(os.tmpdir(), sobra), { recursive: true, force: true });
}

console.log(`\n${verde} conferências verdes, ${falhas.length} vermelhas${falhas.length ? ": " + falhas.join(" | ") : ""}.`);
process.exit(falhas.length ? 1 : 0);
