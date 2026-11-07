/* muta-foto-query.js — falsifica as réguas de foto uma a uma.
   Um portão que ninguém tentou quebrar é uma frase: as mutações abaixo desligam cada
   regra do lib/find-photo.js e exigem que .audit/teste-foto-query.js fique
   vermelho. Teste que continua verde com a regra desligada não testa nada.

   Rodar: node .audit/muta-foto-query.js  (exit 1 se alguma mutação escapar)  */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const FP = path.join(ROOT, "tools", "lib", "find-photo.js");
const CP = path.join(ROOT, "tools", "check-post.js");
const TEST = path.join(ROOT, ".audit", "teste-foto-query.js");

const original = { fp: fs.readFileSync(FP, "utf8"), cp: fs.readFileSync(CP, "utf8") };
const restaurar = () => {
  fs.writeFileSync(FP, original.fp);
  fs.writeFileSync(CP, original.cp);
};
process.on("exit", restaurar);
process.on("SIGINT", () => { restaurar(); process.exit(130); });

const mutacoes = [
  { alvo: "fp", de: "if (melhor.match === 0) {\n    return { photo: null, reason: `pexels: nenhuma das ${data.photos.length} legendas menciona a query` };\n  }", para: "", nome: "Pexels volta a aceitar results[0] sem conferir legenda" },
  { alvo: "fp", de: "if (melhor.match === 0) {\n    return { photo: null, reason: `unsplash: nenhuma das ${data.results.length} legendas menciona a query` };\n  }", para: "", nome: "Unsplash volta a aceitar results[0] sem conferir legenda" },
  { alvo: "fp", de: "if (STOPWORDS.has(w) || NUMERAIS.has(w)) continue;", para: "if (STOPWORDS.has(w)) continue;", nome: "palavrasConcretas para de riscar numeral" },
  { alvo: "fp", de: "if (palavrasConcretas(s).length < 2) return { ok: false, motivo:", para: "if (false) return { ok: false, motivo:", nome: "validaPhotoQuery aceita qualquer coisa" },
  { alvo: "fp", de: "sobreposicao(query, photo.alt_description, photo.description)", para: "sobreposicao(\"\", photo.alt_description, photo.description)", nome: "sobreposicao recebe query vazia" },
  { alvo: "fp", de: '    if (new RegExp(`(^|[^a-z0-9])${w}s?([^a-z0-9]|$)`).test(texto)) n++;', para: "    if (texto.includes(w)) n++;", nome: "volta a casar pedaço de palavra (includes)" },
  { alvo: "fp", de: "    if (b.match === a.match && b.likes > a.likes) return b;", para: "", nome: "escolheMelhor desiste do desempate por curtidas" },
];

const alvos = { fp: FP, cp: CP };
let reprovadas = 0;
for (const m of mutacoes) {
  const src = original[m.alvo];
  const EOL = src.includes("\r\n") ? "\r\n" : "\n";
  const de = m.de.split("\n").join(EOL);
  const para = m.para.split("\n").join(EOL);
  if (!src.includes(de)) {
    console.log(`  !! mutação "${m.nome}" não achou o trecho — portão não é o que eu pensei`);
    reprovadas++;
    continue;
  }
  fs.writeFileSync(alvos[m.alvo], src.replace(de, para));
  let saida = "", code = 0;
  try {
    saida = execFileSync(process.execPath, [TEST], { cwd: ROOT, encoding: "utf8" });
  } catch (err) {
    saida = `${err.stdout || ""}${err.stderr || ""}`;
    code = err.status;
  }
  fs.writeFileSync(alvos[m.alvo], src);
  const falhas = (saida.match(/✗/g) || []).length;
  console.log(`${code === 1 && falhas > 0 ? "  ✓ MORDEU" : "  ✗ NÃO MORDEU"} · ${m.nome} → exit ${code}, ${falhas} conferência(s) vermelha(s)`);
  if (!(code === 1 && falhas > 0)) reprovadas++;
}
console.log(reprovadas ? `${reprovadas} mutação(ões) sem prova` : "todas as mutações foram pega(s) pelo teste");
process.exit(reprovadas ? 1 : 0);
