/* make-cover.js — miniatura determinística para cada post novo.
   Sem foto de banco (direito de imagem) e sem gerar imagem (custo): uma placa
   editorial em SVG com o pilar, o kicker e o título. Mesmo slug, mesma placa.
   Faz duas placas: a do feed (com o título dentro, porque o card é pequeno) e a
   do hero (sem título, porque o hero já compõe o H1 embaixo da imagem e o
   título repetido dentro da placa lê como defeito).
   Uso: node tools/make-cover.js <slug>
        node tools/make-cover.js --from-db <id-da-materia>   (regera as duas placas a partir do catálogo)  */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FROM_DB = process.argv.includes("--from-db");
const SLUG = process.argv.slice(2).filter((a) => !a.startsWith("--"))[0];
if (!SLUG || !/^[a-z0-9_-]+$/.test(SLUG)) {
  console.error("uso: node tools/make-cover.js <slug> | node tools/make-cover.js --from-db <id>");
  process.exit(2);
}

const DIR = path.join(ROOT, "pipeline", "drafts", SLUG);
const OUT_DIR = path.join(ROOT, "images", "covers");
const draftFile = path.join(DIR, "draft.json");
if (!FROM_DB && !fs.existsSync(draftFile)) {
  console.error(`não existe ${path.relative(ROOT, draftFile)} — rode write.js antes`);
  process.exit(1);
}
let draft = {};
let brief = {};
if (FROM_DB) {
  global.window = {};
  require(path.join(ROOT, "js", "articles-db.js"));
  const art = (global.window.HWP_DATABASE.articles || []).find((a) => a.id === SLUG);
  if (!art) {
    console.error(`não achei ${SLUG} em js/articles-db.js`);
    process.exit(1);
  }
  draft = art;
} else {
  draft = JSON.parse(fs.readFileSync(draftFile, "utf8"));
  try { brief = JSON.parse(fs.readFileSync(path.join(DIR, "brief.json"), "utf8")); } catch {}
}

/* Paleta = a do site (css/styles.css). Pilar sem cor própria cai no vermelho. */
const CORES = {
  culture: "#E50914",
  tech: "#0055FF",
  science: "#00A389",
  archive: "#B8860B",
  reviews: "#C23A00",
};
const pilar = String(draft.category || brief.pillar || "culture").toLowerCase();
const cor = CORES[pilar] || CORES.culture;
const kicker = String(draft.kicker || `${pilar.toUpperCase()} // ${String(draft.subtopic || "").toUpperCase()}`).toUpperCase();
const titulo = String(draft.title || SLUG).trim();

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/* Quebra manual: SVG em <img> não tem layout de texto, então cada linha é
   uma decisão nossa. Cabe 4 linhas grandes; título maior encolhe a fonte. */
function quebrar(texto, maxChars) {
  const linhas = [];
  let atual = "";
  for (const palavra of texto.split(/\s+/)) {
    if (!atual) atual = palavra;
    else if (`${atual} ${palavra}`.length <= maxChars) atual += ` ${palavra}`;
    else { linhas.push(atual); atual = palavra; }
  }
  if (atual) linhas.push(atual);
  return linhas;
}
let fonte = 78;
let linhas = quebrar(titulo, 22);
if (linhas.length > 3) { fonte = 64; linhas = quebrar(titulo, 26); }
if (linhas.length > 4) { fonte = 52; linhas = quebrar(titulo, 32); }
if (linhas.length > 4) {
  linhas = linhas.slice(0, 4);
  linhas[3] = linhas[3].replace(/[.,;:—-]*$/, "") + "…";
}

/* Motivo geométrico derivado do slug: mesma placa sempre, placas diferentes
   entre si. Hash simples — não precisa ser bonito, precisa ser estável. */
let h = 0;
for (const c of SLUG) h = (h * 31 + c.charCodeAt(0)) % 100003;
/* d desloca o motivo para o centro do quadro na placa do hero, onde não há
   título ocupando a metade de baixo. */
const arcos = (d) => Array.from({ length: 3 }, (_, i) => {
  const r = 150 + ((h >> (i * 3)) % 9) * 26 + d * 0.6;
  return `<circle cx="${1060 - i * 30 - d}" cy="${140 + i * 40 + d * 0.75}" r="${r}" fill="none" stroke="${cor}" stroke-width="2" opacity="${0.22 - i * 0.06}"/>`;
}).join("\n  ");

const moldura = (corpo) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img">
  <rect width="1200" height="675" fill="#0A0A0A"/>
  ${corpo}
  <rect x="0" y="0" width="14" height="675" fill="${cor}"/>
  <line x1="96" y1="120" x2="1104" y2="120" stroke="#2A2A28" stroke-width="1"/>
  <line x1="96" y1="612" x2="1104" y2="612" stroke="#2A2A28" stroke-width="1"/>
  <text x="96" y="648" font-family="Helvetica Neue, Arial, sans-serif" font-size="19" fill="#A3A39E" letter-spacing="3">HOMEWORLDPRESS.COM</text>
  <text x="1104" y="648" text-anchor="end" font-family="Helvetica Neue, Arial, sans-serif" font-size="19" fill="${cor}" letter-spacing="2">${esc(pilar.toUpperCase())}</text>
</svg>
`;

const yFinal = Math.max(300, 360 + ((4 - linhas.length) * fonte) / 2);
/* O kicker só vai na placa do feed: no hero, o badge "COVER STORY // ..." já
   está em cima da imagem e um segundo rótulo dentro da placa é ruído. */
const rotulo = `<text x="96" y="96" font-family="Helvetica Neue, Arial, sans-serif" font-size="24" font-weight="700" fill="${cor}" letter-spacing="4">${esc(kicker.slice(0, 46))}</text>`;
const corpoFeed = `${rotulo}
  ${arcos(0)}
  ${linhas
    .map((l, i) => `<text x="96" y="${yFinal + i * fonte * 1.12}" font-family="Helvetica Neue, Arial, sans-serif" font-size="${fonte}" font-weight="700" fill="#F7F6F2" letter-spacing="-1">${esc(l)}</text>`)
    .join("\n  ")}`;

/* A placa do hero não leva título: o hero escreve o H1 logo abaixo da imagem e
   o mesmo texto nos dois lugares parece descuido, não hierarquia. No lugar do
   título entra a marca d'água do pilar, do tamanho do quadro, e o motivo
   geométrico assume o centro. */
const corpoHero = `<text x="96" y="470" font-family="Helvetica Neue, Arial, sans-serif" font-size="230" font-weight="700" fill="none" stroke="${cor}" stroke-width="1.5" opacity="0.5" letter-spacing="-6">${esc(pilar.toUpperCase().slice(0, 9))}</text>
  ${arcos(120)}`;

fs.mkdirSync(OUT_DIR, { recursive: true });
const base = FROM_DB ? path.basename(String(draft.image || ""), ".svg") : SLUG;
if (FROM_DB && !String(draft.image || "").startsWith("images/covers/")) {
  console.error(`${SLUG} não usa placa nossa (${draft.image}) — nada regerado`);
  process.exit(1);
}
const rel = `images/covers/${base}.svg`;
const relHero = `images/covers/${base}-hero.svg`;
fs.writeFileSync(path.join(ROOT, rel), moldura(corpoFeed));
fs.writeFileSync(path.join(ROOT, relHero), moldura(corpoHero));
if (FROM_DB) {
  /* O catálogo é a fonte da verdade: regerar a partir dele conserta placa que
     ficou com o título de uma versão anterior do texto. */
  console.log(`placas regeradas de ${SLUG}: ${rel} + ${relHero}`);
  process.exit(0);
}

/* Sem aspas no alt: ele é escrito em atributo HTML e a aspa do título
   fechava o atributo, quebrando o marcador em pedaços. */
const alt = `Placa editorial do pilar ${pilar} com o título ${titulo.replace(/["“”]/g, "")}.`;
if (!draft.image || draft.image === rel) {
  /* A reescrita pode mudar o título depois da primeira capa: se a imagem é a
     nossa, o alt acompanha o título final junto com o SVG. */
  draft.image = rel;
  draft.imageAlt = alt;
  fs.writeFileSync(draftFile, JSON.stringify(draft, null, 2) + "\n");
  console.log(`capa criada: ${rel} + ${relHero} (${linhas.length} linhas de título)`);
} else {
  console.log(`capa atualizada: ${rel} + ${relHero} (o draft já tinha ${draft.image})`);
}
