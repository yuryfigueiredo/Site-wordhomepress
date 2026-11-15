/* teste-devolutiva-localizada.js — o que reprova tem de dizer ONDE, e o que é
   fato de fora não pode reprovar o texto.

   Duas bocas do mesmo defeito, ambas medidas em rodada real:

   · `[rhythm] frase com 35 palavras (máximo 30)` foi a única coisa que a
     tentativa 1 das 06:23 de 15/11 devolveu ao redator, e o contrato do
     `fix.md` mandava "devolva o JSON completo de novo": 1044 palavras
     reescritas para consertar uma linha, com a chamada dentro dos 780 s do
     CLI. Sem localizador, a devolutiva não é um conserto — é uma ordem para
     recomeçar.
   · `[network] devolve HTTP 429` reprovava igual a um 404. Medido em 16
     rodadas: o Phys.org responde 429 em 14 delas. O modelo não tem como fazer
     o site dele responder, então a reprovação gastava os 3 ciclos de reescrita
     e enterrava a pauta por 72 h como `reprovada` — texto bom perdido por um
     bloqueio de robô do lado de lá.

   O que NÃO é afrouxamento: a régua ≤ 30 é a mesma, a contagem de reprovações
   é a mesma (conferida contra a mutação que só arranca o localizador), e 404 /
   410 continuam vermelhos.

   Tudo roda em CÓPIA do repo em /tmp, com servidor HTTP local para o 429 e o
   404 — nada disso toca na máquina do dono nem na fila real.                */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SLUG = "fixture-devolutiva-localizada";
let verde = 0;
const falhas = [];
function confere(nome, ok, dado) {
  if (ok) {
    verde++;
    console.log(`  ✓ ${nome}`);
  } else {
    falhas.push(nome);
    console.log(`  ✗ ${nome}${dado === undefined ? "" : " :: " + String(dado).slice(0, 500)}`);
  }
}

const gitAntes = spawnSync("git", ["-C", ROOT, "status", "--porcelain", "-uno"], { encoding: "utf8" }).stdout;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hwp-devolutiva-"));

/* Dois servidores no mesmo filho: um devolve 404 (fonte morta) e outro devolve
   429 (nosso robô recusado). Os portos nascem do kernel (listen 0) e chegam ao
   pai por arquivo, porque o `spawnSync` do check-post bloqueia o event loop. */
const PRONTO = path.join(tmp, "servidores-pronto");
const filho = spawn(
  process.execPath,
  [
    "-e",
    `const net=require("net"),fs=require("fs");
     const quarenta=net.createServer((s)=>s.end("HTTP/1.1 404 Not Found\\r\\ncontent-length: 0\\r\\n\\r\\n"));
     const quatrocentos=net.createServer((s)=>s.end("HTTP/1.1 429 Too Many Requests\\r\\ncontent-length: 0\\r\\n\\r\\n"));
     let n=0;
     const avisa=()=>{ if(n<2)return; fs.writeFileSync(${JSON.stringify(PRONTO)}, "PRONTO "+quarenta.address().port+" "+quatrocentos.address().port); };
     quarenta.listen(0,"127.0.0.1",()=>{n++;avisa();});
     quatrocentos.listen(0,"127.0.0.1",()=>{n++;avisa();});
     setTimeout(()=>process.exit(0),420000);`,
  ],
  { detached: true, stdio: "ignore" }
);
filho.unref();
const espera = spawnSync("sh", ["-c", `for i in $(seq 200); do [ -s ${PRONTO} ] && exit 0; sleep 0.1; done; exit 1`], { encoding: "utf8" });
const [PORTA_404, PORTA_429] = (espera.status === 0 ? fs.readFileSync(PRONTO, "utf8") : "").split(/\s+/).slice(1).map(Number);
confere("os dois servidores de fixture estão de pé", !!PORTA_404 && !!PORTA_429, `espera.status=${espera.status}`);

/* Uma frase com exatamente n palavras, terminada em ponto. */
const frase = (n) => `sentence ${Array(n - 3).fill("long").join(" ")} ends here.`;
const ALVO = 1100;

function copia(mut) {
  const dir = path.join(tmp, `copia-${mut ? "mut" : "ok"}-${verde}-${Math.random().toString(36).slice(2, 8)}`);
  spawnSync("cp", ["-a", `${ROOT}/.`, `${dir}/`], { stdio: "ignore" });
  const d = path.join(dir, "pipeline", "drafts", SLUG);
  fs.mkdirSync(d, { recursive: true });
  const content =
    `<p>${frase(3)}</p>` +
    `<p>${frase(4)}</p>` +
    `<p>${frase(35)} ${frase(12)}</p>` +
    `<p>${frase(5)}</p>`;
  const draft = {
    id: SLUG,
    title: "Fixture devolutiva localizada sobre antenas de quintal",
    dek: "Um dek de fixture que não repete o título e serve só para o editor mecário rodar.",
    kicker: "SCIENCE",
    category: "science",
    subtopic: "antenas",
    author: "Ana Reyes",
    date: "Nov 15, 2026",
    readTime: "1 MIN READ",
    photoQuery: "backyard radio antenna wire mesh",
    content,
    sources: [
      { url: `http://127.0.0.1:${PORTA_404}/morta`, name: "Fixture Morta", claim: "a fonte não existe mais" },
      { url: `http://127.0.0.1:${PORTA_429}/robos`, name: "Fixture Robô", claim: "o site recusa o robô" },
    ],
    evidence_level: "high",
    self_check: { opening_move: "cena concreta", ending_move: "número", humor_lines: 0 },
  };
  fs.writeFileSync(path.join(d, "draft.json"), JSON.stringify(draft, null, 2) + "\n");
  fs.writeFileSync(path.join(d, "brief.json"), JSON.stringify({ word_count: ALVO, register: "news", sources: draft.sources }, null, 2) + "\n");
  if (mut) {
    const arq = path.join(dir, "tools", "check-post.js");
    const fonte = fs.readFileSync(arq, "utf8");
    fs.writeFileSync(arq, mut(fonte));
  }
  return dir;
}

function julga(dir) {
  const r = spawnSync(process.execPath, [path.join(dir, "tools", "check-post.js"), SLUG], { cwd: dir, encoding: "utf8", timeout: 180000 });
  const out = String(r.stdout || "");
  const linhas = out.split("\n");
  return {
    codigo: r.status ?? -1,
    said: [...linhas.filter((l) => l.includes("✗ [rhythm]")), ...linhas.filter((l) => l.includes("✗ [length]"))],
    ritmo: linhas.filter((l) => l.includes("✗ [rhythm]")),
    rede: linhas.filter((l) => l.includes("✗ [network]")),
    notas: linhas.filter((l) => l.includes("· [network]")),
    out,
  };
}

console.log("\n1. as três réguas de ritmo apontam o bloco e citam a frase");
{
  const r = julga(copia());
  const longa = r.ritmo.find((l) => /frase com 35 palavras/.test(l)) || "";
  confere("a reprovação da frase longa diz o bloco e a quantidade", /bloco 3\/4: "sentence long/.test(longa) && /\(35 palavras\)/.test(longa), longa || r.out.split("\n").slice(0, 8).join(" ⏎ "));
  const perto = r.ritmo.find((l) => /ritmo uniforme/.test(l)) || "";
  confere("a régua do parágrafo longo aponta o bloco mais perto dos 4", /o bloco 3 é o mais perto, com 2 frases/.test(perto), perto);
  const mic = r.ritmo.find((l) => /parágrafos de uma frase/.test(l)) || "";
  confere("a régua de mic-drop lista QUAIS blocos, não só quantos", /blocos 1, 2, 4/.test(mic), mic);
  const comp = r.said.find((l) => /texto com \d+ palavras/.test(l)) || "";
  const piso = require(path.join(ROOT, "tools", "lib", "word-floor.js")).piso(ALVO);
  const medido = frase(3).split(/\s+/).length + frase(4).split(/\s+/).length + frase(35).split(/\s+/).length + frase(12).split(/\s+/).length + frase(5).split(/\s+/).length;
  confere("a reprovação de tamanho diz quantas palavras faltam, pela mesma boca do piso", comp.includes(`faltam ${piso - medido}`), `${comp} (piso ${piso}, texto ${medido})`);
  confere("com a frase de 4+ palavras curtas o portão da frase curta fica quieto", !r.ritmo.some((l) => /falta a frase curta/.test(l)), r.ritmo.join(" ⏎ "));

  /* Mutação: só arrancar o localizador, sem tocar na aritmética. Se a contagem
     de reprovações não mudar, o localizador é informação e não afrouxamento. */
  const semLoc = copia((f) => f.replace("reject(\"rhythm\", `frase com ${longest} palavras (máximo 30)${onde(ache((n) => n > 30))}`)", "reject(\"rhythm\", `frase com ${longest} palavras (máximo 30)`)"));
  confere("a mutação encontrou a linha do localizador", !fs.readFileSync(path.join(semLoc, "tools", "check-post.js"), "utf8").includes("${onde(ache((n) => n > 30))}"), "o replace não alcançou");
  const m = julga(semLoc);
  confere("arrancado o localizador a MESMA frase continua reprovada", m.ritmo.length === r.ritmo.length && m.ritmo.some((l) => /frase com 35 palavras/.test(l)), `${m.ritmo.length} vs ${r.ritmo.length}`);
  confere("e aí a devolutiva volta a não dizer onde — é isto que a prova cobra", !m.ritmo.some((l) => /bloco \d+\//.test(l)), m.ritmo.join(" ⏎ "));
}

console.log("\n2. 404 reprova, 429 não — bloqueio de robô do lado de lá é nota, não reprovação");
{
  const r = julga(copia());
  confere("a fonte morta (404) reprova", r.rede.length === 1 && /404|não existe mais/.test(r.rede[0]), r.rede.join(" ⏎ ") || r.out.slice(0, 400));
  confere("a fonte que recusa o robô (429) sai como observação, não como reprovação", r.notas.some((l) => /429/.test(l)) && !r.rede.some((l) => /429/.test(l)), `notas: ${r.notas.join(" ⏎ ")}`);
  const semBorda = copia((f) => f.replace("if (res.status === 404 || res.status === 410) reject", "if (res.status >= 400) reject"));
  confere("a mutação encontrou a borda do 404", !fs.readFileSync(path.join(semBorda, "tools", "check-post.js"), "utf8").includes("res.status === 404 || res.status === 410"), "token não achado");
  const m = julga(semBorda);
  confere("com a régua antiga o mesmo 429 vira reprovação e custaria os 3 ciclos", m.rede.length === 2 && m.rede.some((l) => /429/.test(l)), `${m.rede.length}: ${m.rede.join(" ⏎ ")}`);
}

console.log("\n3. invariante: a máquina do dono não foi tocada");
{
  const gitDepois = spawnSync("git", ["-C", ROOT, "status", "--porcelain", "-uno"], { encoding: "utf8" }).stdout;
  confere("o repo real está como estava", gitDepois === gitAntes, gitDepois.split("\n").join(" ⏎ "));
  confere("nenhum rascunho de fixture entrou no pipeline/drafts real", !fs.existsSync(path.join(ROOT, "pipeline", "drafts", SLUG)), "apareceu no repo");
  const memReal = JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "memory.json"), "utf8"));
  confere("a memória real não ganhou a pauta de fixture", !Object.keys(memReal.leads || {}).some((u) => u.includes("127.0.0.1")), "entrada localhost na memória");
  spawnSync("kill", [String(filho.pid)]);
  for (const sobra of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, sobra), { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  confere("nenhuma cópia desta prova ficou no /tmp", !fs.existsSync(tmp), `${path.basename(tmp)} continuou no disco`);
}

console.log(`\n${verde} conferências verdes${falhas.length ? `, ${falhas.length} vermelhas: ${falhas.join("; ")}` : "."}`);
process.exit(falhas.length ? 1 : 0);
