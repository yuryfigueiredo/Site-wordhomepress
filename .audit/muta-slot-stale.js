/* .audit/muta-slot-stale.js — prova de que o portão [slot-stale] morde.
   Cada mutação abaixo escreve no HTML, roda o doctor, exige a cor certa e
   restaura o arquivo byte a byte (hash conferido). Se uma mutação não for
   pega, o script sai vermelho: é assim que se descobre que o portão é
   descrição, não portão.

   Rodar: node .audit/muta-slot-stale.js
   Contra o defeito real: 28 cards escritos à mão fora dos marcadores em
   index.html e nas três páginas de editoria (09/11). */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const markup = require(path.join(ROOT, "tools", "lib", "slot-markup"));
const plc = JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "placements.json"), "utf8"));

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
const ler = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const escrever = (f, s) => fs.writeFileSync(path.join(ROOT, f), s);

function doctor() {
  let out = "";
  let code = 0;
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, "tools", "doctor.js"), "--offline"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    code = err.status === undefined ? 1 : err.status;
    out = `${err.stdout || ""}${err.stderr || ""}`;
  }
  return { code, out };
}

/* recorta o primeiro card completo de um slot */
function cardDoSlot(file, slotName) {
  const slot = plc.slots[file].find((s) => s.name === slotName);
  const cls = markup.cardClassOf(slot.template);
  const html = ler(file);
  const dentro = html.slice(
    html.indexOf(markup.marcador(slotName, "start")),
    html.indexOf(markup.marcador(slotName, "end")),
  );
  const abre = `<article class="${cls}"`;
  const p = dentro.indexOf(abre);
  if (p < 0) throw new Error(`nenhum card class="${cls}" dentro de ${slotName}`);
  const card = dentro.slice(p, dentro.indexOf("</article>", p) + "</article>".length);
  return { slot, cls, html, card, id: card.match(/article\.html\?id=([^&"']+)/)[1] };
}

const casos = [];

/* 1. card de MATÉRIA solto depois do :end — o defeito original da CULTURE */
{
  const { html, card, slot, cls, id } = cardDoSlot("index.html", "index-culture");
  const end = markup.marcador(slot.name, "end");
  casos.push({
    nome: `um card class="${cls}" da matéria ${id} volta escrito à mão depois do ${end}`,
    arquivo: "index.html",
    novo: html.slice(0, html.indexOf(end) + end.length) + "\n" + card + "\n          " + html.slice(html.indexOf(end) + end.length),
    espera: "vermelho",
    marca: "FORA dos marcadores",
  });
}

/* 2. o mesmo numa página de editoria (o defeito não era só da home) */
{
  const { html, card, slot, cls } = cardDoSlot("culture.html", "culture-feed");
  const end = markup.marcador(slot.name, "end");
  casos.push({
    nome: `um card class="${cls}" solto depois do ${end} em culture.html`,
    arquivo: "culture.html",
    novo: html.slice(0, html.indexOf(end) + end.length) + "\n" + card + "\n          " + html.slice(html.indexOf(end) + end.length),
    espera: "vermelho",
    marca: "FORA dos marcadores",
  });
}

/* 3. o número da pill discordando da grade */
{
  const html = ler("index.html");
  const m = html.match(/(<[^>]*data-culture-filter="all"[^>]*>[^<()]*\()(\d+)(\))/);
  const real = Number(m[2]);
  casos.push({
    nome: `o rótulo ALL CULTURE diz (${real - 1}) e a grade tem ${real}`,
    arquivo: "index.html",
    novo: html.replace(m[0], `${m[1]}${real - 1}${m[3]}`),
    espera: "vermelho",
    marca: "o rótulo diz",
  });
}

/* 4. curadoria fora do catálogo NÃO é defeito: o portão não pode morder a
      lista TRENDING nem as placas do Dumarest */
{
  const { html, card, slot } = cardDoSlot("index.html", "index-culture");
  const end = markup.marcador(slot.name, "end");
  const curado = card.replace(/article\.html\?id=[^&"']+/g, "dumarest/index.htm");
  casos.push({
    nome: "um card sem link de catálogo (curadoria) solto depois do marcador",
    arquivo: "index.html",
    novo: html.slice(0, html.indexOf(end) + end.length) + "\n" + curado + "\n          " + html.slice(html.indexOf(end) + end.length),
    espera: "verde",
    marca: null,
  });
}

let falhas = 0;
for (const c of casos) {
  const antes = ler(c.arquivo);
  const hashAntes = sha(antes);
  escrever(c.arquivo, c.novo);
  const r = doctor();
  escrever(c.arquivo, antes);
  const restaurado = sha(ler(c.arquivo)) === hashAntes;
  const vermelho = r.code !== 0 || /ERRO\s+\[slot-stale\]/.test(r.out);
  const pegou = c.espera === "vermelho" ? vermelho && r.out.includes(c.marca) : !vermelho;
  if (!pegou || !restaurado) falhas++;
  const linha = r.out.match(/ERRO\s+\[slot-stale\].*/);
  console.log(
    `${pegou && restaurado ? "✓ MORDEU" : "!! FALHOU"} · ${c.nome} → doctor ${vermelho ? "vermelho" : "verde"} · restaurado byte a byte=${restaurado}${linha ? ` · ${linha[0].slice(0, 96)}` : ""}`
  );
}

/* o build tem de devolver o arquivo ao estado anterior: nada aqui deixou rastro */
{
  const antes = ler("index.html");
  execFileSync(process.execPath, [path.join(ROOT, "tools", "build.js")], { cwd: ROOT, stdio: "ignore" });
  console.log(`· build depois das mutações: ${sha(ler("index.html")) === sha(antes) ? "mesmo bytes (idempotente)" : "MUDOU — conferir"}`);
}

console.log(falhas ? `${falhas} mutação(ões) sem prova` : "todas as mutações conferidas — o portão morde matéria solta e não morde curadoria");
process.exit(falhas ? 1 : 0);
