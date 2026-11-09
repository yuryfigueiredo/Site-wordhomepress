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

/* 5. a classe com VARIACAO — `class="article-card is-featured"` — é o mesmo
      card de matéria: o portão que procurava a aspa fechada deixava ele solto,
      subtraindo vaga do slot sem nunca ser acusado (achado do supervisor, 09/11) */
{
  const { html, card, slot, cls } = cardDoSlot("index.html", "index-culture");
  const end = markup.marcador(slot.name, "end");
  const comVariacao = card.replace(`<article class="${cls}"`, `<article class="${cls} is-featured"`);
  casos.push({
    nome: `um card class="${cls} is-featured" solto depois do ${end} (a classe com variacao nao e outra classe)`,
    arquivo: "index.html",
    novo: html.slice(0, html.indexOf(end) + end.length) + "\n" + comVariacao + "\n          " + html.slice(html.indexOf(end) + end.length),
    espera: "vermelho",
    marca: "FORA dos marcadores",
  });
}

/* 6. REVIEW escrita à mão fora do marcador: id de review também é catálogo, e
      reconhecer só article.html?id= a empurrava para a caixa de "curadoria" */
{
  global.window = {};
  require(path.join(ROOT, "js", "articles-db.js"));
  const reviewId = (global.window.HWP_DATABASE.reviews || [])[0].id;
  const { html, slot, cls } = cardDoSlot("index.html", "index-culture");
  const end = markup.marcador(slot.name, "end");
  const cardReview = `<article class="${cls}">\n            <a href="review.html?id=${reviewId}" class="${cls}__media">x</a>\n            <h3><a href="review.html?id=${reviewId}">review escrita a mao</a></h3>\n          </article>`;
  casos.push({
    nome: `uma review do catalogo (${reviewId}) escrita a mao fora do ${end}`,
    arquivo: "index.html",
    novo: html.slice(0, html.indexOf(end) + end.length) + "\n" + cardReview + "\n          " + html.slice(html.indexOf(end) + end.length),
    espera: "vermelho",
    marca: "FORA dos marcadores",
  });
}

/* 7. a ORDEM do feed de categoria: repetir o spotlight no primeiro card, com
      matéria inédita mais abaixo, é o defeito que o "dedup: nenhum" abriu */
{
  const file = "culture.html";
  const html = ler(file);
  const start = markup.marcador("culture-feed", "start");
  const end = markup.marcador("culture-feed", "end");
  const i0 = html.indexOf(start) + start.length;
  const i1 = html.indexOf(end);
  /* O recorte é por fronteira de <article>, não por "\n\n": o card tem quebras
     de linha internas e o link fica no pedaço que o split jogaria fora — foi
     assim que esta mutação ficou verde sem reordenar nada, e um portão provado
     por uma mutação que não faz o que diz é pior do que não ter portão. */
  const regiaoTxt = html.slice(i0, i1);
  const aberturas = [];
  const rx = /<article class="cat-feed-item"/g;
  let mm;
  while ((mm = rx.exec(regiaoTxt))) aberturas.push(mm.index);
  if (aberturas.length < 2) throw new Error("a região culture-feed não tem 2+ cards para reordenar");
  const pedacos = aberturas.map((p, k) => regiaoTxt.slice(p, aberturas[k + 1] ?? regiaoTxt.length));
  const reordenado = [pedacos[pedacos.length - 1], ...pedacos.slice(0, pedacos.length - 1)].join("");
  casos.push({
    nome: "o feed de cultura comeca com a materia que o spotlight acabou de mostrar, e a inédita fica no fim",
    arquivo: file,
    novo: html.slice(0, i0) + reordenado + html.slice(i1),
    espera: "vermelho",
    marca: "repete matéria que já está acima",
  });
}

/* 8. apagar o último card do science-feed: o slot se declarou "acervo", então
      faltar peça é defeito por si — o [slot-stale] morde pelo markup. */
{
  const file = "science.html";
  const html = ler(file);
  const start = markup.marcador("science-feed", "start");
  const end = markup.marcador("science-feed", "end");
  const i0 = html.indexOf(start) + start.length;
  const i1 = html.indexOf(end);
  const regiaoTxt = html.slice(i0, i1);
  const rx = /<article class="cat-feed-item"/g;
  const aberturas = [];
  let mm;
  while ((mm = rx.exec(regiaoTxt))) aberturas.push(mm.index);
  casos.push({
    nome: "o último card do science-feed é apagado (a editoria some do markup)",
    arquivo: file,
    novo: html.slice(0, i0) + regiaoTxt.slice(0, aberturas[aberturas.length - 1]) + html.slice(i1),
    espera: "vermelho",
    portao: "slot-stale",
    marca: 'o slot é "acervo" mas faltam',
  });
}

/* 9. apagar o card que é a ÚNICA ENTRADA de uma matéria (a própria página dela
      não conta — é o destino, não o caminho): aí o [orphan] morde pelo
      catálogo. O caso amarra a mutação à topologia real de links e quebra o
      script se o premise mudar, em vez de ficar verde mentindo. */
{
  const file = "science.html";
  const html = ler(file);
  const start = markup.marcador("science-feed", "start");
  const end = markup.marcador("science-feed", "end");
  const i0 = html.indexOf(start) + start.length;
  const i1 = html.indexOf(end);
  const regiaoTxt = html.slice(i0, i1);
  const rx = /<article class="cat-feed-item"/g;
  const aberturas = [];
  let mm;
  while ((mm = rx.exec(regiaoTxt))) aberturas.push(mm.index);
  const idEm = (p, k) => {
    const m = regiaoTxt.slice(p, aberturas[k + 1] ?? regiaoTxt.length).match(/article\.html\?id=([^&"']+)/);
    return m ? decodeURIComponent(m[1]) : null;
  };
  const paginas = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
  const alvo = aberturas.findIndex((p, k) => {
    const id = idEm(p, k);
    if (!id) return false;
    const proprias = new Set([file, `a-${id}.html`]);
    return !paginas
      .filter((f) => !proprias.has(f))
      .some((f) => {
        const src = ler(f);
        return src.includes(`id=${id}`) || src.includes(`"${id}"`);
      });
  });
  if (alvo < 0) throw new Error("nenhum card do science-feed é a única entrada de uma matéria — reescrever o caso 9");
  const idAlvo = idEm(aberturas[alvo], alvo);
  casos.push({
    nome: `sai do science-feed o card que é a única página que linka ${idAlvo}`,
    arquivo: file,
    novo: html.slice(0, i0) + regiaoTxt.slice(0, aberturas[alvo]) + regiaoTxt.slice(aberturas[alvo + 1] ?? regiaoTxt.length) + html.slice(i1),
    espera: "vermelho",
    portao: "orphan",
    marca: "não é linkado por nenhuma OUTRA página",
  });
}

/* 10. o que salvou o verde mentiroso do [orphan] não é clique: uma menção do
       slug dentro de um <script> na home. Mata o card e planta a menção — o
       portão tem de continuar vermelho, porque ninguém chega na matéria. */
{
  const file = "science.html";
  const html = ler(file);
  const start = markup.marcador("science-feed", "start");
  const end = markup.marcador("science-feed", "end");
  const i0 = html.indexOf(start) + start.length;
  const i1 = html.indexOf(end);
  const regiaoTxt = html.slice(i0, i1);
  const rx = /<article class="cat-feed-item"/g;
  const aberturas = [];
  let mm;
  while ((mm = rx.exec(regiaoTxt))) aberturas.push(mm.index);
  const idEm = (p, k) => {
    const m = regiaoTxt.slice(p, aberturas[k + 1] ?? regiaoTxt.length).match(/article\.html\?id=([^&"']+)/);
    return m ? decodeURIComponent(m[1]) : null;
  };
  const paginas = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
  const alvo = aberturas.findIndex((p, k) => {
    const id = idEm(p, k);
    if (!id) return false;
    const proprias = new Set([file, `a-${id}.html`]);
    return !paginas
      .filter((f) => !proprias.has(f))
      .some((f) => {
        const src = ler(f);
        return src.includes(`article.html?id=${id}`) || src.includes(`review.html?id=${id}`);
      });
  });
  if (alvo < 0) throw new Error("nenhum card do science-feed é a única ENTRADA de uma matéria — reescrever o caso 10");
  const idAlvo = idEm(aberturas[alvo], alvo);
  const indexHtml = ler("index.html");
  const fimBody = indexHtml.lastIndexOf("</body>");
  if (fimBody < 0) throw new Error("index.html sem </body> — o caso 10 precisa de outro ponto de plantio");
  casos.push({
    nome: `card de ${idAlvo} fora do feed, mas o slug citado num <script> da home`,
    arquivo: file,
    novo: html.slice(0, i0) + regiaoTxt.slice(0, aberturas[alvo]) + regiaoTxt.slice(aberturas[alvo + 1] ?? regiaoTxt.length) + html.slice(i1),
    extras: [{ arquivo: "index.html", novo: indexHtml.slice(0, fimBody) + `\n  <script>window.__LEGADO_DE_FEED = ["${idAlvo}"];</script>\n` + indexHtml.slice(fimBody) }],
    espera: "vermelho",
    portao: "orphan",
    marca: "não é linkado por nenhuma OUTRA página",
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
  const tag = c.portao || "slot-stale";
  /* um caso pode tocar mais de um arquivo (é o que o [orphan] precisa: matar o
     card numa página e plantar a menção em outra). Instantâneo e restauração por
     bytes em cada arquivo, com o hash conferido no fim. */
  const edits = [{ arquivo: c.arquivo, novo: c.novo }, ...(c.extras || [])];
  const antes = edits.map((e) => {
    const bytes = ler(e.arquivo);
    return { arquivo: e.arquivo, bytes, hash: sha(bytes) };
  });
  edits.forEach((e) => escrever(e.arquivo, e.novo));
  const r = doctor();
  antes.forEach((a) => escrever(a.arquivo, a.bytes));
  const restaurado = antes.every((a) => sha(ler(a.arquivo)) === a.hash);
  const vermelho = r.code !== 0 || new RegExp(`ERRO\\s+\\[${tag}\\]`).test(r.out);
  const pegou = c.espera === "vermelho" ? vermelho && r.out.includes(c.marca) : !vermelho;
  if (!pegou || !restaurado) falhas++;
  const linha = r.out.match(new RegExp(`ERRO\\s+\\[${tag}\\].*`));
  console.log(
    `${pegou && restaurado ? "✓ MORDEU" : "!! FALHOU"} · [${tag}] ${c.nome} → doctor ${vermelho ? "vermelho" : "verde"} · restaurado byte a byte=${restaurado}${linha ? ` · ${linha[0].slice(0, 96)}` : ""}`
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
