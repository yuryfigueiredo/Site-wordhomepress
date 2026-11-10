/* teste-trava-picks.js — prova do travamento que congelou o site de 08/11 a
   10/11: o doctor exige que o bloco TODAY'S PICKS publicado seja o de HOJE, mas
   quem produz o bloco é o build, que só rodava no fim da rodada. Na virada do
   dia UTC o portão nascia vermelho, a rodada parava antes do build, o bloco
   nunca girava e a rodada seguinte morria igual — três rodadas seguidas assim
   no Actions (42503308640 verde, 42552549247 e 42723448831 vermelhas).

   A correção é o passo 2 do turno.js: `build.js --daily` antes do doctor. Este
   teste reproduz a sequência inteira com relógio falso e exige:
     1. bloco de ontem no ar + doctor de hoje  → VERMELHO [picks] (a trava)
     2. build --daily de hoje                → bloco de hoje no ar
     3. doctor de hoje                       → VERDE
     4. o --daily não toca em mais nada: hero, capa e o resto do index.html
       ficam byte a byte iguais (senão ele gastaria a troca de capa da rodada
       antes de a matéria inédita tomar o hero).
   Tudo restaurado por instantâneo de bytes no fim.

   Rodar: node .audit/teste-trava-picks.js   (exit 1 se alguma etapa vazar)    */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const picks = require(path.join(ROOT, "tools", "lib", "picks-rules"));
const plc = JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "placements.json"), "utf8"));
const slot = plc.slots["index.html"].find((s) => s.rotacao === "dia");
if (!slot) throw new Error("nenhum slot com rotacao diária em index.html — reescrever o teste");

const ARQS = ["index.html", "pipeline/state/cover-state.json", "tools/turno.js"];
const ler = (f) => fs.readFileSync(path.join(ROOT, f));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex").slice(0, 16);
const instantaneo = ARQS.map((f) => ({ f, bytes: ler(f), hash: sha(ler(f)) }));

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
    return { code: 0, out: execFileSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...(env || {}) } }) };
  } catch (e) {
    return { code: e.status == null ? 1 : e.status, out: String(e.stdout || "") + String(e.stderr || "") };
  }
}
const PRELOAD = path.join(ROOT, ".audit", "relogio-falso.js");
const blocoNoAr = () => [...picks.idsDaRegiao(String(ler("index.html")), slot.name)];
const semPicks = () => {
  const html = String(ler("index.html"));
  return html.replace(picks.regiao(html, slot.name), "<REGIAO-PICKS>");
};
const heroNoAr = () => [...picks.idsDaRegiao(String(ler("index.html")), "index-hero")];

const agora = new Date();
const ontem = new Date(agora.getTime() - 86400000);
const diaDe = (d) => Math.floor(d.getTime() / 86400000);

try {
  /* ── 0. a correção É a ordem no turno.js, e ela tem de ser provada ────────
     As etapas 1→4 abaixo provam o mecanismo (build --daily + doctor), mas nunca
     executam o turno.js: apagar o passo 2 ou trocá-lo de lugar com a manutenção
     deixaria a bateria inteira verde. Achado do supervisor em 10/11. Aqui a
     ordem é lida do arquivo de verdade e mordida por duas mutações. */
  const CH_DAILY = 'run("build.js", ["--daily"])';
  const CH_DOCTOR = 'run("doctor.js", ["--offline"])';
  const GUARDA = "if (giro.code !== 0) finish(";
  const ordem = (src) => {
    const d = src.indexOf(CH_DAILY);
    const m = src.indexOf(CH_DOCTOR);
    return {
      daily: d,
      doctor: m,
      antes: d >= 0 && m >= 0 && d < m,
      guarda: d >= 0 && m >= 0 && d < m && src.slice(d, m).includes(GUARDA),
    };
  };
  const turnoSrc = String(ler("tools/turno.js"));
  const real = ordem(turnoSrc);
  confere("turno.js chama o build --daily", real.daily >= 0, `índice ${real.daily}`);
  confere("turno.js chama o doctor --offline", real.doctor >= 0, `índice ${real.doctor}`);
  confere("a rotação diária vem ANTES da manutenção (o destravamento)", real.antes, `daily ${real.daily} · doctor ${real.doctor}`);
  confere("e falhar na rotação diária fecha a rodada antes do doctor", real.guarda);

  const turnoBytes = ler("tools/turno.js");
  /* Mutação A: o passo 2 some — é exatamente o código anterior a 10/11. */
  fs.writeFileSync(path.join(ROOT, "tools/turno.js"), turnoSrc.replace(CH_DAILY, 'run("build.js", ["--dry"])'));
  const semPasso = ordem(String(ler("tools/turno.js")));
  confere("MUTADO: sem o passo 2 a conferência de ordem fica vermelha", !semPasso.antes && semPasso.daily < 0, `daily ${semPasso.daily}`);
  /* Mutação B: o doctor sobe para antes da rotação — a ordem que travava. */
  fs.writeFileSync(path.join(ROOT, "tools/turno.js"), turnoSrc.replace(CH_DAILY, "@@GIRO@@").replace(CH_DOCTOR, CH_DAILY).replace("@@GIRO@@", CH_DOCTOR));
  const invertida = ordem(String(ler("tools/turno.js")));
  confere("MUTADO: com a ordem invertida a conferência fica vermelha", !invertida.antes && invertida.daily > invertida.doctor, `daily ${invertida.daily} · doctor ${invertida.doctor}`);
  fs.writeFileSync(path.join(ROOT, "tools/turno.js"), turnoBytes);
  confere("o turno.js voltou byte a byte depois das mutações", sha(ler("tools/turno.js")) === sha(turnoBytes));

  /* ── 1. planta o bloco de ontem e mostra a trava ─────────────────────── */
  const plantio = node(["-r", PRELOAD, path.join("tools", "build.js"), "--daily"], { HWP_AGORA: ontem.toISOString() });
  confere("build --daily com o relógio de ontem roda", plantio.code === 0, plantio.out.trim().slice(-200));
  const deOntem = blocoNoAr();
  const pool = picks.poolDePicks(
    (() => {
      global.window = {};
      require(path.join(ROOT, "js", "articles-db.js"));
      return global.window.HWP_DATABASE.articles;
    })(),
    slot,
    picks.excluidasDaRotacao(String(ler("index.html"))),
  );
  const esperadoOntem = picks.picksDoDia(pool, slot.limit || 2, diaDe(ontem)).map((a) => a.id);
  const esperadoHoje = picks.picksDoDia(pool, slot.limit || 2, diaDe(agora)).map((a) => a.id);
  confere("o bloco plantado é o que a régua de ontem manda", deOntem.join("|") === esperadoOntem.join("|"), `${deOntem.join(",")} vs ${esperadoOntem.join(",")}`);
  if (deOntem.join("|") === esperadoHoje.join("|")) throw new Error("o bloco de ontem é igual ao de hoje neste pool — o teste não provaria a trava; escolher outro dia");

  const trava = node([path.join("tools", "doctor.js"), "--offline"]);
  confere("doctor de hoje com o bloco de ontem no ar fecha VERMELHO", trava.code !== 0, `exit ${trava.code}`);
  confere("e o erro é o [picks] de bloco velho, não outro", /ERRO\s+\[picks\][^\n]*está com o bloco/.test(trava.out), (trava.out.match(/ERRO[^\n]*/) || ["sem ERRO"])[0]);

  /* ── 2. a correção: --daily de hoje, sem tocar na capa ───────────────── */
  const antesHero = heroNoAr();
  const antesResto = sha(semPicks());
  const antesCapa = sha(ler("pipeline/state/cover-state.json"));
  const giro = node([path.join("tools", "build.js"), "--daily"]);
  confere("build --daily de hoje roda", giro.code === 0, giro.out.trim().slice(-200));
  confere("o bloco no ar passa a ser o que a régua de hoje manda", blocoNoAr().join("|") === esperadoHoje.join("|"), `${blocoNoAr().join(",")} vs ${esperadoHoje.join(",")}`);
  confere("o hero não mudou (a troca de capa da rodada continua intacta)", heroNoAr().join("|") === antesHero.join("|"), `${heroNoAr().join(",")} vs ${antesHero.join(",")}`);
  confere("cover-state.json não foi escrito", sha(ler("pipeline/state/cover-state.json")) === antesCapa);
  confere("nada fora da região de picks mudou no index.html", sha(semPicks()) === antesResto);
  confere("o --daily não sincroniza pill de grade (só bloco diário)", !/pill/.test(giro.out), giro.out.trim().slice(-160));
  confere("e a saída só lista o slot diário — nenhum hero, grade ou feed processado", /index-picks/.test(giro.out) && !/index-hero|index-culture|index-latest|culture-feed|science-feed|tech-feed/.test(giro.out), giro.out.trim().replace(/\n/g, " | "));

  /* ── 3. com o bloco de hoje, a manutenção passa ──────────────────────── */
  const verde = node([path.join("tools", "doctor.js"), "--offline"]);
  confere("doctor de hoje com o bloco de hoje fecha VERDE", verde.code === 0, (verde.out.match(/ERRO[^\n]*/) || [`exit ${verde.code}`])[0]);
  confere("e nenhum [picks] aberto", !/ERRO\s+\[picks\]/.test(verde.out));

  /* ── 4. idempotente: rodar de novo no mesmo dia não muda nada ────────── */
  const antes2 = sha(ler("index.html"));
  node([path.join("tools", "build.js"), "--daily"]);
  confere("segundo --daily no mesmo dia devolve os mesmos bytes", sha(ler("index.html")) === antes2);
} finally {
  instantaneo.forEach((a) => fs.writeFileSync(path.join(ROOT, a.f), a.bytes));
  const restaurado = instantaneo.every((a) => sha(ler(a.f)) === a.hash);
  confere("arquivos restaurados byte a byte", restaurado, instantaneo.map((a) => `${a.f}=${sha(ler(a.f)) === a.hash}`).join(" "));
}

console.log(`\n${ok} conferência(s) verde, ${fail} vermelha(s)`);
process.exit(fail ? 1 : 0);
