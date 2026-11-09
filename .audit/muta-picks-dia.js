/* muta-picks-dia.js — falsifica as réguas do TODAY'S PICKS uma a uma.
   Um portão que ninguém tentou quebrar é uma frase. Cada mutação abaixo desliga
   uma regra (em tools/lib/picks-rules.js, pipeline/cadence.json,
   pipeline/placements.json ou index.html) e exige que o verificador declarado
   fique vermelho:

     "teste"  → node .audit/teste-picks-dia.js
     "doctor" → node tools/doctor.js --offline --quick  (precisa de "ERRO [picks]")

   O par teste/doctor não é intercambiável, e a execução abaixo mostra por quê:
   quebrar a FUNÇÃO de rotação derruba o doctor só quando o par calculado deixa
   de bater com o que está publicado (offset, data, relógio). Três mutações —
   o mínimo do acervo, o filtro de imagem e o desconto do hero — deixam o
   doctor VERDE com o catálogo de hoje, porque ele compara o index.html com a
   mesma função que o build usou: régua quebrada não aparece em espelho. É a
   aritmética de dias e o pool sintético do teste que veem isso. Para as duas
   últimas há ainda uma terceira camada: o doctor checa o HTML publicado contra
   o catálogo por caminho próprio (capa repetida na tela, card sem artigo), e
   as duas últimas mutações provam que essas checagens mordem sozinhas.

   Rodar: node .audit/muta-picks-dia.js  (exit 1 se alguma mutação escapar)     */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const ARQ = {
  pr: path.join(ROOT, "tools", "lib", "picks-rules.js"),
  cad: path.join(ROOT, "pipeline", "cadence.json"),
  plc: path.join(ROOT, "pipeline", "placements.json"),
  idx: path.join(ROOT, "index.html"),
};
const TESTE = path.join(ROOT, ".audit", "teste-picks-dia.js");
const DOUTOR = path.join(ROOT, "tools", "doctor.js");

const original = {};
for (const k of Object.keys(ARQ)) original[k] = fs.readFileSync(ARQ[k], "utf8");
const restaurar = () => {
  for (const k of Object.keys(ARQ)) fs.writeFileSync(ARQ[k], original[k]);
};
process.on("exit", restaurar);
process.on("SIGINT", () => { restaurar(); process.exit(130); });

/* O par de ontem, calculado com a régua real, serve para congelar o index.html
   no estado que ele tinha há 15 dias (a causa é o build não girar; aqui se
   representa a consequência, que é o que o doctor tem de ver). */
const picks = require(ARQ.pr);
global.window = {};
require(path.join(ROOT, "js", "articles-db.js"));
const DB = global.window.HWP_DATABASE;
require(path.join(ROOT, "tools", "lib", "catalog-notes")).aplicar(DB, ROOT);
const slotDia = JSON.parse(original.plc).slots["index.html"].find((s) => s.rotacao === "dia");
const poolReal = picks.poolDePicks(DB.articles, slotDia, picks.excluidasDaRotacao(original.idx));
const hoje = picks.picksDoDia(poolReal, slotDia.limit || 2, picks.diaUtc()).map((a) => a.id);
const ontem = picks.picksDoDia(poolReal, slotDia.limit || 2, picks.diaUtc() - 1).map((a) => a.id);
const idxParDeOntem = () => {
  const ini = "<!-- hwp:auto:index-picks:start -->";
  const fim = "<!-- hwp:auto:index-picks:end -->";
  const a = original.idx.indexOf(ini);
  const b = original.idx.indexOf(fim);
  let regiaoTxt = original.idx.slice(a, b);
  for (let i = 0; i < hoje.length; i++) {
    regiaoTxt = regiaoTxt.split(`article.html?id=${encodeURIComponent(hoje[i])}`).join(`article.html?id=${encodeURIComponent(ontem[i])}`);
  }
  return original.idx.slice(0, a) + regiaoTxt + original.idx.slice(b);
};
const idxComCardManual = () => {
  const a = original.idx.indexOf("<!-- hwp:auto:index-picks:start -->");
  return original.idx.slice(0, a) + '<article class="pick-item"><a href="article.html?id=card-escrito-a-mao">manual</a></article>\n' + original.idx.slice(a);
};
/* Duas simulações que não dependem da função do build: o doctor tem checagens
   que olham o HTML publicado contra o catálogo, então precisam de um HTML
   publicado que as infrinja. */
const idxCapaTambemNoPicks = () => {
  const b = original.idx.indexOf("<!-- hwp:auto:index-hero:end -->");
  return original.idx.slice(0, b) + `<a href="article.html?id=${encodeURIComponent(hoje[0])}">capa repetida</a>` + original.idx.slice(b);
};
const idxPickSemArtigo = () => {
  const a = original.idx.indexOf("<!-- hwp:auto:index-picks:start -->");
  const b = original.idx.indexOf("<!-- hwp:auto:index-picks:end -->");
  const trecho = original.idx
    .slice(a, b)
    .split(`article.html?id=${encodeURIComponent(hoje[1])}`)
    .join("article.html?id=id-que-nao-existe-no-catalogo");
  return original.idx.slice(0, a) + trecho + original.idx.slice(b);
};

const mutacoes = [
  /* — a FUNÇÃO de rotação — */
  { alvo: "pr", espera: "teste", de: "  const offset = (((diaUtc % lista.length) + lista.length) % lista.length);", para: "  const offset = 0;", nome: "o offset congela: todo dia o mesmo par (o defeito de 15 dias)" },
  { alvo: "pr", espera: "teste", de: "const minimoParaRotacao = (n) => n + 1;", para: "const minimoParaRotacao = (n) => n;", nome: "mínimo vira n (a régua passaria a prometer troca impossível)" },
  { alvo: "pr", espera: "teste", de: "    .filter((a) => a.bookCover || a.image)", para: "", nome: "card sem foto volta a entrar no pool" },
  { alvo: "pr", espera: "teste", de: "    .sort((x, y) => tempoDeData(y.date) - tempoDeData(x.date)", para: "    .sort((x, y) => tempoDeData(x.date) - tempoDeData(y.date)", nome: "ordem por data invertida (a mais velha vira 'hoje')" },
  { alvo: "pr", espera: "teste", de: "const diaUtc = (ms) => Math.floor((ms === undefined ? Date.now() : ms) / 86400000);", para: "const diaUtc = (ms) => Math.floor((ms === undefined ? Date.now() : ms) / 3600000);", nome: "a unidade vira hora (6 trocas/dia e o rótulo 'hoje' mente)" },
  { alvo: "pr", espera: "teste", de: 'const excluidasDaRotacao = (html) => idsDaRegiao(html, "index-hero");', para: "const excluidasDaRotacao = () => new Set();", nome: "o hero deixa de descontar (capa repetida na mesma tela)" },
  /* — a RÉGUA declarada — */
  { alvo: "cad", espera: "doctor", de: '"picks_changes_per_day": 1,', para: '"picks_changes_per_day": 3,', nome: "meta de picks vira 3 sem nada que gire 3x/dia" },
  { alvo: "cad", espera: "doctor", de: '"picks_changes_per_day": 1,', para: "", nome: "a régua sai do cadence.json (volta a morar na conversa)" },
  { alvo: "plc", espera: "doctor", de: '"rotacao": "dia"', para: '"rotacao": "nunca"', nome: "o slot perde a rotação (volta a ser bloco fixo)" },
  { alvo: "plc", espera: "doctor", de: '"template": "pick-item", "category": "culture", "limit": 3', para: '"template": "pick-item", "category": "culture", "limit": 1', nome: "limit vira 1 com 3 cards publicados no ar" },
  /* — o que está PUBLICADO — */
  { alvo: "idx", espera: "doctor", arquivo: idxParDeOntem, nome: "o build não girou e a home acorda com o par de ontem" },
  { alvo: "idx", espera: "doctor", arquivo: idxComCardManual, nome: "um card pick-item escrito à mão reaparece fora dos marcadores" },
  { alvo: "idx", espera: "doctor", arquivo: idxCapaTambemNoPicks, marca: "repete a capa", nome: "a matéria que já é a capa entra no par de hoje (espelho build/doctor não vê; a checagem vê)" },
  { alvo: "idx", espera: "doctor", arquivo: idxPickSemArtigo, marca: "sem artigo no catálogo", nome: "card do bloco apontando para id que não existe no catálogo" },
];

function rodaTeste() {
  try {
    return { code: 0, out: execFileSync(process.execPath, [TESTE], { cwd: ROOT, encoding: "utf8" }) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ""}${err.stderr || ""}` };
  }
}
function rodaDoutor() {
  try {
    return { code: 0, out: execFileSync(process.execPath, [DOUTOR, "--offline", "--quick"], { cwd: ROOT, encoding: "utf8" }) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ""}${err.stderr || ""}` };
  }
}

let reprovadas = 0;
console.log(`par de hoje: ${hoje.join(", ")}\npar de ontem:  ${ontem.join(", ")}`);
for (const m of mutacoes) {
  const base = m.arquivo ? m.arquivo() : original[m.alvo];
  let novo;
  if (m.arquivo) {
    novo = base;
  } else {
    const EOL = base.includes("\r\n") ? "\r\n" : "\n";
    const de = m.de.split("\n").join(EOL);
    const para = m.para.split("\n").join(EOL);
    if (!base.includes(de)) {
      console.log(`  !! "${m.nome}" não achou o trecho — portão não é o que eu pensei`);
      reprovadas++;
      continue;
    }
    novo = base.replace(de, para);
  }
  fs.writeFileSync(ARQ[m.alvo], novo);
  const t = rodaTeste();
  const d = rodaDoutor();
  restaurar();
  const testeMordeu = t.code === 1;
  const doutorMordeu = d.code === 1 && /ERRO\s+\[picks\]/.test(d.out);
  const marcaOk = !m.marca || new RegExp(m.marca).test(d.out);
  const esperado = (m.espera === "teste" ? testeMordeu : doutorMordeu) && marcaOk;
  const outro = m.espera === "teste" ? (doutorMordeu ? " · doctor também mordeu" : " · doctor ficou VERDE") : (testeMordeu ? " · teste também mordeu" : "");
  const errosPicks = [...d.out.matchAll(/ERRO\s+\[picks\][^\n]*/g)].map((x) => x[0]);
  const detalhe =
    m.espera !== "doctor"
      ? (t.out.match(/✗[^\n]*/g) || []).slice(0, 2).join(" | ").slice(0, 120)
      : m.marca
      ? (errosPicks.find((e) => new RegExp(m.marca).test(e)) || `SEM a mensagem "${m.marca}" · ${errosPicks[0] || "nenhum erro de picks"}`).slice(0, 130)
      : (errosPicks[0] || "sem erro de picks").slice(0, 130);
  console.log(`${esperado ? "  ✓ MORDEU" : "  ✗ NÃO MORDEU"} · ${m.nome} → ${m.espera} vermelho=${esperado ? "sim" : "NÃO"}${outro} · ${detalhe}`);
  if (!esperado) reprovadas++;
}
console.log(reprovadas ? `${reprovadas} mutação(ões) sem prova` : "todas as mutações foram pega(s) — régua, função e o que está publicado");
process.exit(reprovadas ? 1 : 0);
