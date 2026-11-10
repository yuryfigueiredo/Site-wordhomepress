/* teste-trava-arquivo.js — prova do EPERM que derrubava a rodada sem defeito
   editorial nenhum. Medido em 10/11: a bateria de provas estourou na rodada 1 do
   teste de capa com `EPERM ... rename 'index.html.tmp' -> 'index.html'`. No
   Windows o antivírus/indexador segura o alvo por um instante depois de o tmp
   ser escrito; o renameSync não espera e o build morre. A correção é o
   lib/atomic-write: rename com fôlego SÓ para erro de trava (EPERM/EACCES/EBUSY),
   e as cinco escritas versionadas do pipeline passando por ele (build.js no HTML
   e no fallback da capa, lib/lastRuns.js, lib/memory.js e lib/cover-state.js).

   O teste morde dos dois lados:
     - com o helper, duas falhas de trava seguidas ainda entregam o arquivo;
     - SEM o helper (mutação no build.js), uma falha já derruba o build.
   Erro que não é trava sobe na hora, sem gastar as seis tentativas.

   Rodar: node .audit/teste-trava-arquivo.js   (exit 1 se alguma etapa vazar)   */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const atomic = require(path.join(ROOT, "tools", "lib", "atomic-write"));
const picks = require(path.join(ROOT, "tools", "lib", "picks-rules"));
const plc = JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "placements.json"), "utf8"));
const slot = plc.slots["index.html"].find((s) => s.rotacao === "dia");

const ARQS = ["index.html", "pipeline/state/cover-state.json", "tools/build.js"];
const ler = (f) => fs.readFileSync(path.join(ROOT, f));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex").slice(0, 16);
const instantaneo = ARQS.map((f) => ({ f, bytes: ler(f), hash: sha(ler(f)) }));
const PRELOAD = path.join(ROOT, ".audit", "trava-arquivo-falsa.js");
const SCRATCH = path.join(ROOT, ".audit", "tmp-trava-arquivo");

let ok = 0;
let fail = 0;
function confere(nome, cond, detalhe) {
  if (cond) {
    ok++;
    console.log(`  ✓ ${nome}`);
  } else {
    fail++;
    console.log(`  ✗ ${nome}${detalhe !== undefined ? ` → ${detalhe}` : ""}`);
  }
}
function node(args, env) {
  try {
    return { code: 0, out: execFileSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...(env || {}) }, maxBuffer: 32 * 1024 * 1024 }) };
  } catch (e) {
    return { code: e.status == null ? 1 : e.status, out: String(e.stdout || "") + String(e.stderr || "") };
  }
}
const erroDe = (code) => Object.assign(new Error(`${code} sintético`), { code });

try {
  fs.mkdirSync(path.join(SCRATCH, "pipeline"), { recursive: true });

  /* ── 1. o helper: fôlego para trava, nenhum para erro de outra natureza ── */
  const real = fs.renameSync;
  const alvo = path.join(SCRATCH, "alvo.txt");
  const tmp = `${alvo}.tmp`;
  let chamadas = 0;
  const comFalhas = (n, code) => {
    chamadas = 0;
    fs.renameSync = function (...args) {
      chamadas++;
      if (chamadas <= n) throw erroDe(code);
      return real.apply(this, args);
    };
  };
  try {
    fs.writeFileSync(alvo, "velho");
    fs.writeFileSync(tmp, "novo");
    comFalhas(2, "EPERM");
    const tentativas = atomic.renomear(tmp, alvo);
    confere("duas travas EPERM seguidas ainda entregam o arquivo", fs.readFileSync(alvo, "utf8") === "novo", fs.readFileSync(alvo, "utf8"));
    confere("e o rename foi tentado 3 vezes, não 6", tentativas === 3 && chamadas === 3, `tentativas ${tentativas} · chamadas ${chamadas}`);
    confere("o tmp não sobra depois do rename", !fs.existsSync(tmp));

    fs.writeFileSync(alvo, "velho");
    fs.writeFileSync(tmp, "novo");
    comFalhas(99, "ENOENT");
    let estourou = null;
    try { atomic.renomear(tmp, alvo); } catch (e) { estourou = e; }
    confere("ENOENT sobe na hora, sem gastar as seis tentativas", estourou && estourou.code === "ENOENT" && chamadas === 1, `chamadas ${chamadas}`);
    confere("e o alvo não foi tocado pelo erro que não é trava", fs.readFileSync(alvo, "utf8") === "velho");

    fs.writeFileSync(tmp, "novo");
    comFalhas(99, "EPERM");
    estourou = null;
    try { atomic.renomear(tmp, alvo); } catch (e) { estourou = e; }
    confere("trava que nunca solta estoura depois do fôlego, não fica em loop", estourou && estourou.code === "EPERM" && chamadas === atomic.TENTATIVAS, `chamadas ${chamadas} de ${atomic.TENTATIVAS}`);

    fs.writeFileSync(tmp, "novo");
    comFalhas(0, "EPERM");
    confere("sem trava nenhuma o rename passa de primeira", atomic.renomear(tmp, alvo) === 1 && fs.readFileSync(alvo, "utf8") === "novo");
  } finally {
    fs.renameSync = real;
  }

  /* ── 2. os três gravadores atômicos passam pelo helper ─────────────────── */
  const rodaGravador = (lib, chamada, falhas) =>
    node(["-r", PRELOAD, "-e", `const m = require(${JSON.stringify(path.join(ROOT, "tools", "lib", lib))}); m.${chamada};`], { HWP_FALHAS_RENAME: String(falhas) });
  const rootJson = JSON.stringify(SCRATCH);
  const lr = rodaGravador("lastRuns.js", `gravar(${rootJson}, { runs: { teste: 1 } })`, 2);
  confere("lastRuns.gravar entrega o arquivo com duas travas no caminho", lr.code === 0, lr.out.trim().slice(-200));
  const mem = rodaGravador("memory.js", `gravar(${rootJson}, { leads: {}, publishes: [] })`, 2);
  confere("memory.gravar entrega a contabilidade com duas travas no caminho", mem.code === 0, mem.out.trim().slice(-200));
  /* A memória da capa é o caso mais caro: loadState engole JSON truncado e devolve
     estado vazio, então uma escrita direta partida ao meio zeraria a memória em
     silêncio. Reescrever o estado lido não muda o conteúdo, e o finally devolve
     os bytes do mesmo jeito. */
  const cs = rodaGravador("cover-state.js", "saveState(m.loadState())", 2);
  confere("cover-state.saveState entrega a memória da capa com duas travas", cs.code === 0, cs.out.trim().slice(-200));

  /* Invariante que morde sozinha: nenhum gravador do pipeline chama o rename cru.
     Se alguém acrescentar um fs.renameSync novo, esta linha fica vermelha. */
  const crus = [];
  for (const dir of ["tools", "tools/lib"]) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (!f.endsWith(".js") || f === "atomic-write.js") continue;
      const src = fs.readFileSync(path.join(ROOT, dir, f), "utf8");
      if (/fs\.renameSync\s*\(/.test(src)) crus.push(`${dir}/${f}`);
    }
  }
  confere("nenhum renameSync cru sobrou no pipeline (todos passam pelo helper)", crus.length === 0, crus.join(", "));

  /* ── 3. o build inteiro, com o antivírus simulado no index.html ────────── */
  const blocoNoAr = () => [...picks.idsDaRegiao(String(ler("index.html")), slot.name)];
  const agora = new Date();
  const ontem = new Date(agora.getTime() - 86400000);
  const diaDe = (d) => Math.floor(d.getTime() / 86400000);
  const RELOGIO = path.join(ROOT, ".audit", "relogio-falso.js");
  /* O bloco de hoje já está no ar: sem plantar o de ontem o --daily é idempotente,
     NÃO escreve arquivo nenhum e o teste passaria sem nunca ver um rename. Foi
     exatamente assim que a primeira versão deste teste deu verde na mutação. */
  const plantaOntem = () => {
    const r = node(["-r", RELOGIO, path.join("tools", "build.js"), "--daily"], { HWP_AGORA: ontem.toISOString() });
    if (r.code !== 0) throw new Error(`não consegui plantar o bloco de ontem: ${r.out.trim().slice(-200)}`);
  };
  const poolDe = () => picks.poolDePicks(
    (() => {
      global.window = {};
      delete require.cache[require.resolve(path.join(ROOT, "js", "articles-db.js"))];
      require(path.join(ROOT, "js", "articles-db.js"));
      return global.window.HWP_DATABASE.articles;
    })(),
    slot,
    picks.excluidasDaRotacao(String(ler("index.html"))),
  );
  plantaOntem();
  const esperadoOntem = picks.picksDoDia(poolDe(), slot.limit || 2, diaDe(ontem)).map((a) => a.id);
  const esperadoHoje = picks.picksDoDia(poolDe(), slot.limit || 2, diaDe(agora)).map((a) => a.id);
  if (esperadoOntem.join("|") === esperadoHoje.join("|")) throw new Error("o bloco de ontem é igual ao de hoje neste pool — o teste não provaria a escrita");
  confere("o plantio deixou o bloco de ontem no ar (há o que escrever)", blocoNoAr().join("|") === esperadoOntem.join("|"), blocoNoAr().join(","));

  const antesCapa = sha(ler("pipeline/state/cover-state.json"));
  const giro = node(["-r", PRELOAD, path.join("tools", "build.js"), "--daily"], { HWP_FALHAS_RENAME: "2" });
  confere("build --daily roda com duas travas de arquivo no caminho", giro.code === 0, giro.out.trim().slice(-260));
  confere("e o bloco no ar é o que a régua de hoje manda", blocoNoAr().join("|") === esperadoHoje.join("|"), `${blocoNoAr().join(",")} vs ${esperadoHoje.join(",")}`);
  confere("a capa continua intacta (o --daily não gira hero)", sha(ler("pipeline/state/cover-state.json")) === antesCapa);
  confere("nenhum .tmp ficou no diretório do site", !fs.existsSync(path.join(ROOT, "index.html.tmp")));

  /* ── 4. mutação: sem o helper, uma trava já derruba o build ────────────── */
  const srcBuild = String(ler("tools/build.js"));
  const linha = 'require("./lib/atomic-write").renomear(tmp, target);';
  if (!srcBuild.includes(linha)) throw new Error("o build.js não chama mais o atomic-write — reescrever a mutação");
  plantaOntem();
  fs.writeFileSync(path.join(ROOT, "tools/build.js"), srcBuild.replace(linha, "fs.renameSync(tmp, target);"));
  const semHelper = node(["-r", PRELOAD, path.join("tools", "build.js"), "--daily"], { HWP_FALHAS_RENAME: "1" });
  confere("MUTADO: sem o helper, uma trava EPERM derruba o build", semHelper.code !== 0 && /EPERM/.test(semHelper.out), `exit ${semHelper.code} · ${(semHelper.out.match(/EPERM[^\n]*/) || ["sem EPERM no log"])[0]}`);
  confere("e o mutado não deixou o bloco de hoje no ar", blocoNoAr().join("|") !== esperadoHoje.join("|"), blocoNoAr().join(","));
  fs.writeFileSync(path.join(ROOT, "tools/build.js"), instantaneo.find((a) => a.f === "tools/build.js").bytes);
  const deVolta = node(["-r", PRELOAD, path.join("tools", "build.js"), "--daily"], { HWP_FALHAS_RENAME: "1" });
  confere("com o helper de volta, a mesma trava não derruba nada", deVolta.code === 0 && blocoNoAr().join("|") === esperadoHoje.join("|"), deVolta.out.trim().slice(-200));
} finally {
  instantaneo.forEach((a) => fs.writeFileSync(path.join(ROOT, a.f), a.bytes));
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  confere("arquivos restaurados byte a byte", instantaneo.every((a) => sha(ler(a.f)) === a.hash), instantaneo.map((a) => `${a.f}=${sha(ler(a.f)) === a.hash}`).join(" "));
  confere("o diretório de scratch não sobrou", !fs.existsSync(SCRATCH));
}

console.log(`\n${ok} conferência(s) verde, ${fail} vermelha(s)`);
process.exit(fail ? 1 : 0);