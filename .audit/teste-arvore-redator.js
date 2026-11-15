/* teste-arvore-redator.js — o timeout do redator mata a ÁRVORE, não só o filho direto.

   O defeito, medido por quem olhou /proc durante a rodada de 15/11 que morreu no
   `chamada_max_ms`: a parede era `spawnSync({timeout})`, que manda SIGTERM
   apenas para o processo que ele mesmo lançou. O `qodercli` do app é um pai que
   levanta um worker, e o worker levanta outro. Mortos os diretos (turno.js,
   write.js, qodercli), o worker viveu 81 s e 105 s e o bisneto 40 s.
   Consequência tripla: o `timeout 65m` do cinto deixou de garantir o fim da
   rodada, o plano do app continuou sendo gasto DENTRO da rodada seguinte, e o
   `desfazerFotosDaRodada()` apagou jpgs que um escritor órfão ainda ia usar.

   A correção tem três bocas (descida por /proc, censo com carimbo de nascimento,
   gancho de saída) e este arquivo confere cada uma, mais o contrato de leitura
   que o `spawn` novo não pode quebrar: o texto inteiro, o veredito de binário
   ausente, o 429 de quota e o motivo de timeout que o `turno.js` imprime.

   Não roda a rodada nem gasta uma linha do plano: o `bin` do provedor é trocado
   por um script de fixture em /tmp, que grava o PID do próprio neto em
   `HWP_PROVA_NETO` para que a conferência seja "este PID está vivo?" e não
   "espera 90 s e reza". A prova de mutação refaz o `chamarCli` com o kill
   antigo, numa CÓPIA do módulo em /tmp — o arquivo do repo não é tocado, e o que
   se confere é que a conferência muda de cor.                                     */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const providersReal = require(path.join(ROOT, "tools/lib/providers"));

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hwp-arvore-"));
const gitAntes = spawnSync("git", ["-C", ROOT, "status", "--porcelain"], { encoding: "utf8" }).stdout;
const vivo = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* CLI de fixture. O corpo muda por nome; a cabeça é sempre a mesma: consome o
   stdin (o prompt chega pelo pipe), levanta um neto de 120 s e grava o PID dele.
     verde    — devolve o JSON e sai: a chamada que funciona.
     trava    — devolve nada e dorme: a chamada que o `chamada_max_ms` corta.
     cota     — sai 1 gritando quota: o 429 que o provedor reserva entende.
     saida3   — sai 3 por outro motivo: 500 com o código na mensagem.
     grudento — escreve 400 KB, sai, e deixa o NETO segurando o stdout aberto:
               é o caso em que `close` nunca chega e só a folga de dreno devolve. */
const CORPOS = {
  verde: `echo '{"texto":"materia de fixture"}'`,
  trava: `sleep 120`,
  cota: `echo "You have exceeded your plan quota" >&2\nexit 1`,
  saida3: `echo "nada aproveitado" >&2\nexit 3`,
  grudento: `printf '{"texto":"'\nhead -c 400000 /dev/zero | tr '\\0' 'x'\nprintf '"}'`,
};
const LEN_GRUDENTO = 10 + 400000 + 2;

function fixture(kind) {
  const p = path.join(tmp, `cli-${kind}.sh`);
  fs.writeFileSync(
    p,
    `#!/bin/bash
cat > /dev/null
( sleep 120 ) &
echo $! > "$HWP_PROVA_NETO"
${CORPOS[kind]}
`,
    { mode: 0o755 }
  );
  return p;
}

async function chamar(prov, kind, ms, bin) {
  const neto = path.join(tmp, `neto-${kind}-${Math.random().toString(36).slice(2, 7)}.pid`);
  fs.writeFileSync(neto, "0");
  process.env.HWP_PROVA_NETO = neto;
  const t0 = Date.now();
  const r = await prov.chamar({ nome: "prova", tipo: "cli", bin: bin || fixture(kind) }, "plano-do-app", "PROMPT DE FIXTURE", ms);
  const texto = await r.text();
  return { ok: r.ok, status: r.status, texto, neto, durou: Date.now() - t0, pid: Number(fs.readFileSync(neto, "utf8").trim()) };
}

/* O órfão que a conferência caça: vivo depois de a chamada ter terminado é o
   worker de 81 s da medição. Morto na hora é o que o `kill(-)` do grupo e a
   descida por /proc prometem. */
function colher(rótulo, pid) {
  if (vivo(pid)) {
    console.log(`     (${rótulo}: neto ${pid} ainda vivo — limpo para a próxima conferência)`);
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

/* O wrapper é a rodada: um processo que chama o provedor com prazo longo e fica
   vivo. Ele é lançado com grupo próprio e morto por SIGTERM no grupo, exatamente
   como o `timeout 65m` do runner faz com `node tools/turno.js`. O que volta é o
   PID do wrapper e o do neto do redator, lidos do arquivo que o fixture escreve. */
async function caminhoDoCinto(modulo) {
  const wrapper = path.join(tmp, `rodada-${Math.random().toString(36).slice(2, 7)}.js`);
  fs.writeFileSync(
    wrapper,
    `const prov = require(${JSON.stringify(modulo)});
prov.chamar({ nome: "prova", tipo: "cli", bin: ${JSON.stringify(fixture("trava"))} }, "plano-do-app", "PROMPT", 700000).then((r) => r.text()).then((t) => console.log("fim:", t));
setInterval(() => {}, 1000);
`
  );
  const neto = path.join(tmp, `neto-cinto-${Math.random().toString(36).slice(2, 7)}.pid`);
  fs.writeFileSync(neto, "0");
  const filho = require("child_process").spawn(process.execPath, [wrapper], {
    cwd: ROOT,
    env: { ...process.env, HWP_PROVA_NETO: neto },
    stdio: "ignore",
    detached: true,
  });
  await espera(3000);
  const pidNeto = Number(fs.readFileSync(neto, "utf8").trim());
  try {
    process.kill(-filho.pid, "SIGTERM");
  } catch {}
  await espera(2500);
  return { wrapper: filho.pid, neto: pidNeto };
}

async function main() {
  console.log("== 1. chamada verde: o texto chega inteiro e a árvore não sobrevive ==");
  const v = await chamar(providersReal, "verde", 40000);
  confere("respondeu ok", v.ok === true, v.texto);
  confere("status 200", v.status === 200, v.status);
  confere("o texto chega byte a byte, com a quebra que o echo põe (era isso que o spawnSync devolvia)", v.texto === '{"texto":"materia de fixture"}\n', JSON.stringify(v.texto));
  confere("terminou em segundos, não no timeout", v.durou < 12000, `durou=${v.durou}ms`);
  confere("o fixture levantou um neto de verdade", v.pid > 1, `pid=${v.pid}`);
  confere("o neto está MORTO logo depois da chamada (censo + kill no caminho verde)", !vivo(v.pid), `neto=${v.pid} seguiu vivo`);
  colher("verde", v.pid);

  console.log("== 2. chamada travada: o timeout corta, e o neto vai junto ==");
  const t = await chamar(providersReal, "trava", 30000);
  confere("não ok", t.ok === false, t.texto);
  confere("o motivo é o timeout, na boca que o turno.js imprime", /^timeout de 30s no CLI$/.test(t.texto), JSON.stringify(t.texto));
  confere("cortado em ~30 s, não nos 120 s do sleep", t.durou >= 30000 && t.durou < 33000, `durou=${t.durou}ms`);
  confere("o neto do timeout está morto (descida por /proc com o pai vivo)", !vivo(t.pid), `neto=${t.pid} sobreviveu ao corte`);
  colher("trava", t.pid);

  console.log("== 3. neto segurando o stdout: a folga de dreno devolve, não enforca ==");
  const g = await chamar(providersReal, "grudento", 30000);
  confere("a chamada terminou antes do timeout (exit + folga, não close eterno)", g.durou < 12000, `durou=${g.durou}ms`);
  confere("os 400 KB de stdout foram lidos por extenso (exit != stream fechado)", g.texto.length === LEN_GRUDENTO, `len=${g.texto.length}`);
  confere("o texto começa e termina como foi escrito", g.texto.startsWith('{"texto":"') && g.texto.endsWith('"}'), JSON.stringify(g.texto.slice(0, 20)) + "…" + JSON.stringify(g.texto.slice(-5)));
  confere("o neto que segurava o pipe foi morto com a chamada", !vivo(g.pid), `neto=${g.pid}`);
  colher("grudento", g.pid);

  console.log("== 4. vereditos que o write.js consome ==");
  const c = await chamar(providersReal, "cota", 40000);
  confere("quota no stderr vira 429, não 500", c.status === 429, `status=${c.status} ${JSON.stringify(c.texto)}`);
  const s3 = await chamar(providersReal, "saida3", 40000);
  confere("saída 3 vira 500 com o código na mensagem", s3.status === 500 && /saiu com 3/.test(s3.texto), JSON.stringify(s3.texto));
  const sumido = await chamar(providersReal, "verde", 40000, path.join(tmp, "binario-que-nao-existe.sh"));
  confere("binário ausente é veredito, não exceção", sumido.ok === false && /não está no disco/.test(sumido.texto), JSON.stringify(sumido.texto));

  console.log("== 5. mutação: volta o kill antigo e a conferência muda de cor ==");
  /* Copia só `tools/lib/`: providers.js exige load-env.js e rank-models.js do
     mesmo diretório, e nenhum dos dois toca o repo nesta rota. */
  const caixa = path.join(tmp, "mut");
  fs.mkdirSync(path.join(caixa, "tools/lib"), { recursive: true });
  const origem = path.join(ROOT, "tools/lib");
  const alvo = path.join(caixa, "tools/lib/providers.js");
  const antes = fs.readFileSync(path.join(origem, "providers.js"), "utf8");
  for (const f of fs.readdirSync(origem)) {
    if (f.endsWith(".js")) fs.copyFileSync(path.join(origem, f), path.join(caixa, "tools/lib", f));
  }
  const mutado = antes.replace(
    "      podar(pid, vistos);",
    "      try { process.kill(pid, \"SIGTERM\"); } catch {}"
  );
  confere("a mutação encontrou a poda e trocou por SIGTERM no filho direto", mutado !== antes && mutado.includes('process.kill(pid, "SIGTERM")'), "o texto alvo do replace não bate com o arquivo");
  fs.writeFileSync(alvo, mutado);
  const m = await chamar(require(alvo), "trava", 30000);
  confere("com o kill antigo o veredito de timeout continua saindo", /^timeout de 30s/.test(m.texto), JSON.stringify(m.texto));
  confere("e o neto do kill antigo CONTINUA VIVO — é o órfão medido em produção", vivo(m.pid), `neto=${m.pid} morreu mesmo sem a árvore, a conferência não discrimina`);
  colher("mutação", m.pid);
  confere("o arquivo do repo não foi tocado pela mutação", fs.readFileSync(path.join(ROOT, "tools/lib/providers.js"), "utf8") === antes);

  console.log("== 6. caminho do cinto: SIGTERM no grupo da rodada não deixa o redator atrás ==");
  /* O `timeout 65m` do runner mata o GRUPO da rodada. Como o filho agora é
     líder de grupo próprio (`detached`), esse corte não o alcança — o que o
     alcança é o relay de sinal do módulo. Este caso é a prova de que o relay é
     carga, não enfeite: sem ele, a parede do cinto teria trocado um órfão
     medido por um órfão novo. */
  const cinto = await caminhoDoCinto(path.join(ROOT, "tools/lib/providers.js"));
  confere("o wrapper (a rodada) morreu no SIGTERM", !vivo(cinto.wrapper), `wrapper=${cinto.wrapper}`);
  confere("com o relay posto, o grupo do redator morreu junto", !vivo(cinto.neto), `neto=${cinto.neto} sobreviveu ao corte do grupo`);
  colher("cinto", cinto.neto);

  console.log("== 7. mutação do relay: arrancado o gancho, o órfão volta ==");
  const caixa2 = path.join(tmp, "mut-relay");
  fs.mkdirSync(path.join(caixa2, "tools/lib"), { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, "tools/lib"))) {
    if (f.endsWith(".js")) fs.copyFileSync(path.join(ROOT, "tools/lib", f), path.join(caixa2, "tools/lib", f));
  }
  const alvo2 = path.join(caixa2, "tools/lib/providers.js");
  const semRelay = fs.readFileSync(alvo2, "utf8").replace("  process.on(sig, ouvir);", "  /* relay arrancado pela mutação */");
  confere("a mutação encontrou o gancho do sinal", semRelay !== fs.readFileSync(alvo2, "utf8") && semRelay.includes("arrancado pela mutação"));
  fs.writeFileSync(alvo2, semRelay);
  const semRelayCinto = await caminhoDoCinto(alvo2);
  confere("sem o relay, o wrapper morre do mesmo jeito", !vivo(semRelayCinto.wrapper), `wrapper=${semRelayCinto.wrapper}`);
  confere("e o redator CONTINUA VIVO — é o órfão que o `detached` criaria", vivo(semRelayCinto.neto), `neto=${semRelayCinto.neto} morreu sem o relay, a conferência não discrimina`);
  colher("sem relay", semRelayCinto.neto);

  console.log("== 8. invariantes ==");
  const gitDepois = spawnSync("git", ["-C", ROOT, "status", "--porcelain"], { encoding: "utf8" }).stdout;
  confere("git status idêntico ao antes", gitDepois === gitAntes, `${JSON.stringify(gitAntes)} -> ${JSON.stringify(gitDepois)}`);
  confere("nenhum fixture escrito dentro do repo", !fs.existsSync(path.join(ROOT, "cli-verde.sh")) && !fs.existsSync(path.join(ROOT, "tools/lib/cli-verde.sh")));
  confere("o redator armado do repo continua sendo o CLI do app", providersReal.armados().map((p) => p.tipo).join(",") === "cli", providersReal.armados().map((p) => p.nome).join(","));
}

main()
  .then(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n${verde} conferências verdes, ${falhas.length} vermelhas${falhas.length ? ": " + falhas.join(" | ") : ""}`);
    if (falhas.length) process.exitCode = 1;
  })
  .catch((e) => {
    console.error("a prova morreu:", e);
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exitCode = 1;
  });
