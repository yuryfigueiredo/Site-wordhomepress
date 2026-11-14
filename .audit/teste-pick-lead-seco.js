/* teste-pick-lead-seco.js — prova de que `pick-lead.js --dry` mostra a escolha
   da próxima rodada sem comprometer pauta nenhuma.

   O defeito é de preço, não de cor: AGENTS.md avisa que rodar o pick-lead à mão
   "também compromete a pauta" (`em_andamento` tira a fonte da fila por 6h, e uma
   fonte que não abre sai por 12h), e foi exatamente isso que aconteceu nesta
   máquina em 14/11 — duas olhadas na fila, duas pautas queimadas a 2h30 do
   horário seguinte. A alternativa documentada (`ingest.js --show`) lista a fila
   crua, sem os filtros de memória, idade e coluna, então ela não responde a
   pergunta que quem olha está fazendo: "o que a rodada vai pegar?".

   O `--dry` responde com a mesma seleção e nenhuma escrita. É isto que se
   confere aqui, em cópias do repo no /tmp: a boca seca deixa `memory.json` byte
   a byte como estava, a boca molhada grava `em_andamento` na URL que ela mesma
   imprimiu, e as duas imprimem a mesma pauta. Sem o caso molhado a asserção de
   "nenhuma escrita" seria vazia — pode ser que nenhuma das duas escreva nunca. */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const fixtures = [];
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

const memAntes = fs.readFileSync(path.join(ROOT, "pipeline", "memory.json"), "utf8");

function copia() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwp-pickseco-"));
  fixtures.push(dir);
  /* o "/." é o que copia o CONTEÚDO: sem ele o cp leva a pasta para dentro da
     fixture e o tools/pick-lead.js não existe no caminho que a fixture lê. */
  execFileSync("cp", ["-a", `${ROOT}/.`, `${dir}/`], { stdio: "ignore" });
  return dir;
}

function roda(dir, args) {
  let out = "";
  let code = 0;
  try {
    out = execFileSync(process.execPath, [path.join(dir, "tools", "pick-lead.js"), ...args], { cwd: dir, stdio: "pipe", timeout: 300000 }).toString();
  } catch (err) {
    code = err.status === undefined ? -1 : err.status;
    out = String(err.stdout || "") + String(err.stderr || "");
  }
  const mem = fs.readFileSync(path.join(dir, "pipeline", "memory.json"), "utf8");
  const stdout = (out.match(/^\{.*\}$/m) || [null])[0];
  return { code, mem, stdout, saida: out };
}

console.log("1. a boca seca não escreve; a molhada escreve a mesma pauta");
const dirSeca = copia();
const dirMolhada = copia();
const memoriaOriginal = fs.readFileSync(path.join(dirSeca, "pipeline", "memory.json"), "utf8");

const seco = roda(dirSeca, ["--dry"]);
confere("--dry saiu com o código da escolha (0 com pauta, 1 sem pauta)", seco.code === 0 || seco.code === 1, `código ${seco.code} · ${seco.saida.slice(0, 200)}`);
confere("--dry deixou o memory.json byte a byte como estava", seco.mem === memoriaOriginal, "o arquivo mudou");

const molhado = roda(dirMolhada, []);
confere("sem --dry o memory.json muda (é isto que o --dry tem de evitar)", molhado.mem !== memoriaOriginal, "as duas bocas não escreveram nada — a comparação acima seria vazia");
confere("as duas bocas chegam na mesma pauta", seco.stdout === molhado.stdout, `${String(seco.stdout).slice(0, 120)} ≠ ${String(molhado.stdout).slice(0, 120)}`);

if (seco.stdout && molhado.stdout) {
  const escolha = JSON.parse(molhado.stdout);
  const registro = JSON.parse(molhado.mem).leads[escolha.url];
  confere("a molhada marca a pauta que imprimiu como em_andamento", registro && registro.outcome === "em_andamento", JSON.stringify(registro));
  const noSeco = JSON.parse(seco.mem).leads[escolha.url];
  confere("a seca não deixou rastro nenhum da mesma pauta", noSeco === undefined || noSeco.outcome !== "em_andamento", JSON.stringify(noSeco));
} else {
  confere("fila vazia: as duas bocas saem 1 com o mesmo resumo", seco.code === 1 && molhado.code === 1, `seco ${seco.code} · molhado ${molhado.code}`);
}

console.log("\n2. falsificação: sem o guard do --dry a seca volta a queimar pauta");
{
  const dir = copia();
  const arq = path.join(dir, "tools", "pick-lead.js");
  const fonte = fs.readFileSync(arq, "utf8");
  const mutada = fonte.replace("if (!SECO) mem.registrar(ROOT, c.url, \"em_andamento\"", "mem.registrar(ROOT, c.url, \"em_andamento\"");
  confere("a mutação encontrou o registro da pauta", mutada !== fonte, "o texto do guard mudou de forma — atualize a mutação");
  fs.writeFileSync(arq, mutada);
  const r = roda(dir, ["--dry"]);
  confere("com o guard arrancado, --dry escreve e a olhada custa 6h de fila", r.mem !== memoriaOriginal, "a asserção de cima não estaria medindo nada");
}

for (const dir of new Set([...fixtures, ...fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith("hwp-pickseco-")).map((d) => path.join(os.tmpdir(), d))])) {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("\n3. invariante: a fila desta máquina não foi tocada pela prova");
{
  confere("o memory.json real é o mesmo de antes", fs.readFileSync(path.join(ROOT, "pipeline", "memory.json"), "utf8") === memAntes);
  confere("nenhuma fixture ficou em disco", fixtures.every((d) => !fs.existsSync(d)), fixtures.filter((d) => fs.existsSync(d)).join(", "));
}

console.log(`\n${verde} conferências verdes, ${falhas.length} vermelhas${falhas.length ? ": " + falhas.join(" | ") : ""}.`);
process.exit(falhas.length ? 1 : 0);
