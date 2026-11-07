/* teste-furo-cadencia.js — furar o teto continua sendo decisão humana, mas
   deixa de ser invisível.
   Medido pelo supervisor em 07/11: duas das três publicações do dia tinham
   entrado com `--force-cadence` e nada no repositório dizia isso depois — a
   resposta só saía lendo TURNO.md rodada por rodada. Agora o registro carrega
   `forcada: true` e o doctor.js conta os furos da semana.

   Rodar: node .audit/teste-furo-cadencia.js  (exit 1 se algo vazar)

   AVISO: este teste escreve em pipeline/memory.json por alguns instantes e
   restaura o byte original na saída (exit, exceção e Ctrl+C). */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const MEM = path.join(ROOT, "pipeline", "memory.json");
const originalMem = fs.readFileSync(MEM, "utf8");
const restaurar = () => fs.writeFileSync(MEM, originalMem);
process.on("exit", restaurar);
process.on("SIGINT", () => { restaurar(); process.exit(130); });
process.on("uncaughtException", (err) => { console.log(`  ✗ exceção: ${err.message}`); restaurar(); process.exit(1); });

let ok = 0;
let fail = 0;
function confere(nome, cond, detalhe) {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { fail++; console.log(`  ✗ ${nome}${detalhe !== undefined ? ` → ${detalhe}` : ""}`); }
}

/* ── [1] o registro, em raiz temporária (pipeline/memory.json de verdade
         não é tocado aqui) ─────────────────────────────────────────────── */
console.log("\n[1] registrarPublicacao grava o furo");
const mem = require(path.join(ROOT, "tools", "lib", "memory"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "furo-"));
fs.mkdirSync(path.join(tmp, "pipeline"), { recursive: true });
fs.writeFileSync(path.join(tmp, "pipeline", "memory.json"), JSON.stringify({ leads: {}, publishes: [] }));

mem.registrarPublicacao(tmp, ["https://example.com/a"], "sem-furo", 7.1);
mem.registrarPublicacao(tmp, ["https://example.com/b"], "com-furo", 6.9, true);
const pubs = mem.ler(tmp).publishes;
confere("publicação normal não ganha a marca", pubs.find((p) => p.id === "sem-furo").forcada === undefined, JSON.stringify(pubs[0]));
confere("publicação com --force-cadence ganha forcada:true", pubs.find((p) => p.id === "com-furo").forcada === true, JSON.stringify(pubs[1]));
confere("os outros campos do registro continuam iguais (id/at/score)", ["sem-furo", "com-furo"].every((id) => {
  const p = pubs.find((x) => x.id === id);
  return typeof p.at === "string" && p.score !== null;
}));
confere("o teto continua contando as furadas (furar não some do dia)", mem.ler(tmp).publishes.length === 2);
fs.rmSync(tmp, { recursive: true, force: true });

/* ── [2] o call site repassa o flag ─────────────────────────────────────── */
/* Amarramento, não comportamento: publicar de verdade exigiria um rascunho e
   mexeria no catálogo. O que se pega aqui é a regressão real — alguém editar a
   linha e perder o 5º argumento, ou o `furos` parar de ser alimentado. */
console.log("\n[2] publish.js liga o travão furado ao registro");
const pubSrc = fs.readFileSync(path.join(ROOT, "tools", "publish.js"), "utf8");
confere("registrarPublicacao recebe o flag do furo", /registrarPublicacao\(\s*ROOT,[\s\S]{0,200}?FORCAR\s*&&\s*furos\.length\s*>\s*0\s*\)/.test(pubSrc), "assinatura do call site mudou");
confere("o travão do teto alimenta furos[]", /if \(doneToday >= cadence\.max_publishes_per_day\) furos\.push/.test(pubSrc));
confere("o travão da distância mínima alimenta furos[]", /horasDesde < minimoHoras\) furos\.push/.test(pubSrc));
confere("sem travão ativo o --force-cadence não se registra como furo", /FORCAR && furos\.length/.test(pubSrc));

/* ── [3] a manutenção conta os furos da semana ──────────────────────────── */
console.log("\n[3] doctor.js vê o furo");
const semFuro = execFileSync(process.execPath, [path.join(ROOT, "tools", "doctor.js"), "--offline", "--quick"], { cwd: ROOT, encoding: "utf8" });
confere("sem forcada:true no registro, não há aviso de override", !/cadence-override/.test(semFuro), semFuro.match(/aviso \[cadence[^\n]*/g));

const j = JSON.parse(originalMem);
const dia = j.publishes.length ? j.publishes[j.publishes.length - 1].at.slice(0, 10) : new Date().toISOString().slice(0, 10);
j.publishes[j.publishes.length - 1] = { ...j.publishes[j.publishes.length - 1], forcada: true };
fs.writeFileSync(MEM, JSON.stringify(j, null, 2) + "\n");
let saida = "", code = 0;
try {
  saida = execFileSync(process.execPath, [path.join(ROOT, "tools", "doctor.js"), "--offline", "--quick"], { cwd: ROOT, encoding: "utf8" });
} catch (err) {
  saida = `${err.stdout || ""}${err.stderr || ""}`;
  code = err.status;
}
restaurar();
confere("com uma publicação marcada, o doctor emite cadence-override", /aviso \[cadence-override\]/.test(saida), saida.slice(0, 120));
confere("o aviso nomeia a matéria furada", /cadence-override\][^\n]*/.test(saida) && saida.match(/cadence-override\][^\n]*/)[0].includes(j.publishes[j.publishes.length - 1].id), saida.match(/aviso \[cadence-override\][^\n]*/));
confere("aviso, não erro: furar o teto não trava a rodada", code === 0 && !/ERRO\s+\[cadence-override\]/.test(saida), `exit ${code}`);
confere("o byte de pipeline/memory.json voltou ao original", fs.readFileSync(MEM, "utf8") === originalMem);

console.log(`\n${ok} conferência(s) verde, ${fail} vermelha(s)`);
process.exit(fail ? 1 : 0);
