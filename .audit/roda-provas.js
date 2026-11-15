/* roda-provas.js — o portão que faltava em volta das provas.

   Por que existe (P0 de R3, medido 15/11): provas como `muta-slot-stale`,
   `teste-trava-arquivo`, `teste-trava-picks`, `teste-capa-rodada` e `verify`
   escrevem dentro de `tools/` e do `pipeline/state/` do PRÓPRIO repo, numa
   janela em que o `tools/` é exatamente o que a rodada do cron executa. Duas
   bocas abertas: (a) uma SIGINT ou um `throw` no meio da prova deixa a fixture
   no disco — o `finally` do arquivo morre junto com o processo — e o cinto, que
   roda `git add -A` na verde, commitaria um `tools/build.js` mutilado; (b) a
   janela entre sujar e restaurar é código de fixture servindo matéria de verdade.

   Este runner fecha as duas bocas:
   1. não começa com rastreado sujo na entrada — os não rastreados que já
      estavam na árvore são lembrados e nunca apagados;
   2. não começa dentro de janela de rodada — o `flock` do cinto na mão, ou a
      menos de `FOLGA_MIN` de um horário do `cadence.json` (o `--forcar` ignora
     só isto, nunca o item 1);
   3. restaura pelo HEAD o que qualquer prova sujar, inclusive em SIGINT,
      SIGTERM, exceção sem catch e exit;
   4. fecha o placar conferindo que a árvore voltou a estar como estava.

   O que a restauração NÃO é: `git clean -fdq` global nem `checkout .` global.
   Só os caminhos que a prova suja são tocados, um a um, e o que era rastreado
   volta do blob do HEAD — o que estava limpo na entrada é o HEAD, e é ele que
   volta. Por isso o item 1 não é negociável: com a árvore suja na entrada, o
   que ela guarda é trabalho do dono, e este runner não tem o direito de apagá-lo.

   Uso:
     node .audit/roda-provas.js                      # a bateria declarada abaixo
     node .audit/roda-provas.js teste-trava-picks    # só o que o nome casa
     node .audit/roda-provas.js --so rascunho        # filtro por trecho
     node .audit/roda-provas.js --pula provedor      # exclui
     node .audit/roda-provas.js --forcar             # roda perto do horário mesmo assim
   Saída: 0 com todo verde; 1 com qualquer prova vermelha ou restauração devida. */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const AUDIT = __dirname;
const CADENCE = path.join(ROOT, "pipeline", "cadence.json");
/* O cinto desta máquina (fora do repo por decisão do dono): o lock é o que diz
   se uma rodada está em curso AGORA, sem a gente ter que adivinhar pelo relógio. */
const LOCK = process.env.HWP_LOCK || path.join(process.env.HOME || "", ".local/state/hwp/turno.lock");
const FOLGA_MIN = Number(process.env.HWP_PROVAS_FOLGA || 20);

const ARGS = process.argv.slice(2);
const flagVal = (nome) => {
  const i = ARGS.indexOf(`--${nome}`);
  return i >= 0 ? ARGS[i + 1] : null;
};
const FORCAR = ARGS.includes("--forcar");
const TIMEOUT_MS = Number(flagVal("timeout") || 15 * 60 * 1000);

/* A bateria: o que existe em .audit com nome de prova. Ficam fora da lista os
   braços visuais herdados da outra máquina — `verify.js`, `cdp*.js`, `shoot.js`
   e companhia — que exigem Chrome num caminho `C:/Program Files/…` e um servidor
   em :8080. Não são portões do pipeline, e uma boca vermelha permanente no
   placar é exatamente o ruído que esconde a vermelha de verdade. */
const BATERIA = fs
  .readdirSync(AUDIT)
  .filter((f) => /^(teste|muta)-.*\.js$/.test(f))
  .sort();

const VALOR = new Set();
for (const nome of ["so", "pula", "timeout"]) {
  const i = ARGS.indexOf(`--${nome}`);
  if (i >= 0 && ARGS[i + 1] !== undefined && !String(ARGS[i + 1]).startsWith("--")) VALOR.add(ARGS[i + 1]);
}
const selecao = ARGS.filter((a) => !a.startsWith("-") && !VALOR.has(a));
const busca = flagVal("so");
const pula = flagVal("pula");
let provas = BATERIA.filter((f) => {
  const base = f.replace(/\.js$/, "");
  if (selecao.length && !selecao.some((s) => base.includes(s.replace(/^\.audit\//, "").replace(/\.js$/, "")))) return false;
  if (busca && !base.includes(busca)) return false;
  if (pula && base.includes(pula)) return false;
  return true;
});
if (!provas.length) {
  console.error(`roda-provas: nenhuma prova casa com a seleção — a bateria tem ${BATERIA.length}: ${BATERIA.join(", ")}`);
  process.exit(1);
}
console.log(`roda-provas: ${provas.length} prova(s) na mesa: ${provas.join(", ")}`);

function git(...args) {
  return spawnSync("git", ["-C", ROOT, ...args], { encoding: "utf8" });
}

/* O retrato sujo: pares {caminho, rastreia}. Com `-z` não há ambiguidade de
   aspas nem de espaço no nome — e é o formato que sobrevive a rename. */
function sujos() {
  const r = git("status", "--porcelain", "-z", "--untracked-files=all");
  if (r.status !== 0) throw new Error(`git status falhou: ${r.stderr}`);
  const saida = [];
  for (const registro of r.stdout.split("\0")) {
    if (!registro) continue;
    const estado = registro.slice(0, 2);
    const caminho = registro.slice(3);
    if (!caminho) continue;
    saida.push({ caminho, estado, rastreia: estado[0] !== "?" });
  }
  return saida;
}

/* A entrada separa duas coisas que um `git status` sozinho não separa: o que é
   trabalho do dono (rastreado e sujo, ou já novo na árvore antes da bateria) e
   o que é resíduo de prova (sujo que nasceu depois, ou novo que não estava
   aqui). Rastreado sujo na entrada = barra, porque devolver ao HEAD seria
   apagar o dono. Não rastreado na entrada = lembrado e nunca apagado: o próprio
   roda-provas antes do primeiro commit é um caso real desse. */
const entradaSujos = sujos();
const entradaRastreados = entradaSujos.filter((s) => s.rastreia);
const jaEraNovo = new Set(entradaSujos.filter((s) => !s.rastreia).map((s) => s.caminho));
const naoRestauravel = new Set();

/* Devolver ao blob do HEAD é quase certo, mas não é byte a byte: com
   `core.autocrlf=input` os `tools/*.js` desta máquina vivem CRLF no disco e LF
   no objeto, e um `git checkout` depois de cada prova trocaria o fim de linha
   de tudo que ela mutilou — verde para o git, diferente para quem compara os
   bytes do próprio disco (e as provas comparam: `teste-trava-arquivo` confere
   hash antes e depois). O espelho é mais honesto: na entrada, com a árvore
   rastreada provada limpa, os bytes do disco SÃO o estado da entrada. Só o que
   uma prova alcança a tocar é espelhado (tools, pipeline, js, voice, css e a
   raiz); fora disso, a volta é pelo HEAD e isso fica dito na linha. */
const ESPELHO = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hwp-espelho-")), "arvore");
const RAZOES = /^(tools|pipeline|js|voice|css)\//;
const espelhados = new Map();
for (const caminho of git("ls-files", "-z").stdout.split("\0").filter(Boolean)) {
  if (!RAZOES.test(caminho) && !/^[^/]+$/.test(caminho)) continue;
  const completo = path.join(ROOT, caminho);
  if (!fs.existsSync(completo)) continue;
  const destino = path.join(ESPELHO, caminho);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(completo, destino);
  espelhados.set(caminho, destino);
}

function restaurar(lista, motivo) {
  const devida = lista.filter((s) => !jaEraNovo.has(s.caminho));
  const intocaveis = lista.filter((s) => jaEraNovo.has(s.caminho));
  for (const s of intocaveis) naoRestauravel.add(s.caminho);
  if (!devida.length) return 0;
  console.log(`\nroda-provas: ${motivo} — devolvendo ${devida.length} caminho(s) ao estado da entrada:`);
  let erros = 0;
  for (const { caminho, rastreia } of devida) {
    if (rastreia) {
      const volta = espelhados.get(caminho);
      if (volta && fs.existsSync(volta)) {
        fs.mkdirSync(path.dirname(path.join(ROOT, caminho)), { recursive: true });
        fs.copyFileSync(volta, path.join(ROOT, caminho));
        console.log(`  ↺ ${caminho} (bytes da entrada)`);
        continue;
      }
      const r = git("checkout", "--", caminho);
      if (r.status !== 0) {
        /* APAGAR um rastreado que a prova deletou é o `checkout` acima; um que
           está corrompido de um jeito que o checkout não alcança sobe para o
           placar em vez de virar restauração silenciosa pela metade. */
        console.log(`  ✗ ${caminho} :: ${r.stderr.trim()}`);
        erros++;
        continue;
      }
      console.log(`  ↺ ${caminho} (devolvido do HEAD — fora do espelho)`);
    } else {
      fs.rmSync(path.join(ROOT, caminho), { recursive: true, force: true });
      console.log(`  × ${caminho} (novo na árvore, apagado)`);
    }
  }
  return erros;
}

/* 1. portão da árvore. */
if (entradaRastreados.length) {
  console.error(
    `roda-provas: a árvore tem trabalho seu na entrada (${entradaRastreados.length} caminho(s) rastreado(s) sujo(s)) — nenhuma prova roda.\n` +
      "As provas mutilam tools/ e pipeline/state/ e devolvem ao blob do HEAD; com edição\n" +
      "sua não commitada na mesa, devolver ao HEAD seria apagar seu trabalho. Commit ou\n" +
      "stash antes, e os não rastreados ficam onde estão (este runner usa a lista da\n" +
      "entrada para nunca tocar num arquivo que já era seu):\n" +
      entradaRastreados.map((s) => `  ${s.estado} ${s.caminho}`).join("\n")
  );
  process.exit(1);
}
/* A entrada limpa é o que autoriza a restauração pelo HEAD: se algo sujar, o
   blob do HEAD É o estado da entrada, caminho a caminho. */

/* 2. portão da janela de rodada. */
function proximosHorarios() {
  let cad;
  try {
    cad = JSON.parse(fs.readFileSync(CADENCE, "utf8"));
  } catch (e) {
    return { erro: `cadence.json ilegível: ${e.message}` };
  }
  const horas = (cad.check_hours || []).map((h) => h.split(":").map(Number));
  if (!horas.length) return { erro: "cadence.json sem check_hours" };
  const tz = cad.timezone || "America/Sao_Paulo";
  const agora = new Date();
  const partes = (d) => {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
    const g = (t) => Number(f.find((x) => x.type === t).value);
    return { y: g("year"), mo: g("month"), d: g("day"), h: g("hour"), mi: g("minute") };
  };
  const agoraTz = partes(agora);
  const minTz = agoraTz.h * 60 + agoraTz.mi;
  const minutos = horas.map(([hh, mm]) => hh * 60 + mm).sort((a, b) => a - b);
  /* Distância no dia do fuso: o próximo horário de hoje, ou o primeiro de amanhã. */
  const distancias = minutos
    .map((m) => ({ m, delta: m - minTz }))
    .filter((x) => x.delta >= 0)
    .concat(minutos.map((m) => ({ m, delta: m + 1440 - minTz })));
  distancias.sort((a, b) => a.delta - b.delta);
  const prox = distancias[0];
  return { tz, min: minTz, proximo: `${String(Math.floor(prox.m / 60)).padStart(2, "0")}:${String(prox.m % 60).padStart(2, "0")}`, emMin: prox.delta };
}

{
  const trancado = LOCK && fs.existsSync(LOCK) ? spawnSync("flock", ["-n", LOCK, "-c", "true"], { encoding: "utf8" }) : { status: 0 };
  if (trancado.status !== 0) {
    console.error(`roda-provas: uma rodada está em curso agora (${LOCK} travado) — as provas mexem no mesmo tools/ que ela executa.`);
    if (!FORCAR) process.exit(1);
    console.error("roda-provas: --forcar posto, seguindo com a rodada na mesa. Risco assumido.");
  }
  const janela = proximosHorarios();
  if (janela.erro) {
    console.error(`roda-provas: ${janela.erro} — sem o cadence.json não há como saber a janela da rodada.`);
    if (!FORCAR) process.exit(1);
  } else if (janela.emMin < FOLGA_MIN) {
    console.error(`roda-provas: faltam ${janela.emMin} min para o horário ${janela.proximo} (${janela.tz}); a bateria precisa de árvore limpa por toda a rodada.`);
    if (!FORCAR) process.exit(1);
    console.error("roda-provas: --forcar posto, seguindo na janela da rodada.");
  } else {
    console.log(`roda-provas: janela livre — próximo horário ${janela.proximo} da ${janela.tz} daqui a ${janela.emMin} min, lock do cinto desocupado.`);
  }
}

/* 3. as provas, com restauração em toda boca de saída. */
process.on("exit", () => {
  const erros = restaurar(sujos(), "saída");
  if (erros) console.error(`roda-provas: ${erros} caminho(s) não voltarão ao estado da entrada — confira git status.`);
});
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    restaurar(sujos(), `interrompido por ${sig}`);
    process.exit(sig === "SIGINT" ? 130 : 143);
  });
}

const placar = [];
for (const arquivo of provas) {
  const antes = sujos();
  if (antes.length) restaurar(antes, `estado sujo achado antes de ${arquivo}`);
  process.stdout.write(`\n=== ${arquivo}\n`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(AUDIT, arquivo)], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  const sujo = sujos();
  const devolvidos = restaurar(sujo, `${arquivo} terminou com a árvore suja`);
  const saida = `${r.stdout || ""}${r.stderr || ""}`;
  const verde = Number((saida.match(/(\d+) conferências verdes/) || [])[1] ?? -1);
  const vermelhas = Number((saida.match(/(\d+) vermelhas/) || [])[1] ?? -1);
  const cortada = r.status === null || (r.error && r.error.code === "ETIMEDOUT");
  placar.push({
    arquivo,
    cor: r.status === 0 && !cortada && !devolvidos && (vermelhas <= 0) ? "verde" : "vermelho",
    verde,
    vermelhas,
    min: ((Date.now() - t0) / 60000).toFixed(1),
    exit: r.status,
    sujo: sujo.length,
    cortada,
  });
  const ultimo = saida.trim().split("\n").filter(Boolean).slice(-1)[0] || "(sem saída)";
  console.log(`    ${ultimo.slice(0, 200)} · exit ${r.status} em ${placar[placar.length - 1].min} min${sujo.length ? ` · ${sujo.length} caminho(s) restaurado(s)` : ""}`);
}

/* 4. placar + invariante da árvore. */
console.log("\n=== bateria ===");
for (const p of placar) {
  console.log(`  ${p.cor === "verde" ? "✓" : "✗"} ${p.arquivo.padEnd(36)} ${p.verde >= 0 ? `${p.verde} verdes / ${p.vermelhas} vermelhas` : `exit ${p.exit}`}${p.sujo ? ` · ${p.sujo} restaurados` : ""}${p.cortada ? " · CORTADA no teto de tempo" : ""}`);
}
/* O que restou sujo: resíduo de prova é vermelho, o arquivo que já era novo na
   entrada (este runner antes do commit, por exemplo) é só mencionado. */
const resíduo = sujos().filter((s) => !jaEraNovo.has(s.caminho));
if (resíduo.length) {
  console.error(`\nroda-provas: a árvore continua suja depois da bateria:\n${resíduo.map((s) => `  ${s.estado} ${s.caminho}`).join("\n")}`);
}
if (naoRestauravel.size) console.error(`roda-provas: ${naoRestauravel.size} caminho(s) não rastreados na entrada foram deixados em paz: ${[...naoRestauravel].join(", ")}`);
/* A invariante não é "o git diz limpo": é byte a byte contra o espelho da
   entrada. Um `checkout` que normalizou CRLF→LF deixaria o git verde e a
   conferência falsa — foi por isso que o espelho entrou. */
const divergentes = [];
for (const [caminho, volta] of espelhados) {
  const completo = path.join(ROOT, caminho);
  const agora = fs.existsSync(completo) ? fs.readFileSync(completo) : null;
  const antes = fs.readFileSync(volta);
  if (!agora || !agora.equals(antes)) divergentes.push(caminho);
}
if (divergentes.length) console.error(`roda-provas: ${divergentes.length} caminho(s) não voltaram byte a byte ao espelho da entrada: ${divergentes.join(", ")}`);
fs.rmSync(path.dirname(ESPELHO), { recursive: true, force: true });
const vermelhas = placar.filter((p) => p.cor !== "verde").length;
const estragos = resíduo.length + divergentes.length;
console.log(`\n${placar.length} provas: ${placar.length - vermelhas} verdes, ${vermelhas} vermelhas${estragos ? ` + ${estragos} boca(s) de estrago na árvore` : ""}.`);
process.exit(vermelhas || estragos ? 1 : 0);
