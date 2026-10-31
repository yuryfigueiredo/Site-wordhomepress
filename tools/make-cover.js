/* make-cover.js — miniatura determinística para cada post novo.
   Sem foto de banco (direito de imagem) e sem gerar imagem (custo): uma placa
   editorial em SVG com o pilar, o kicker e o título. Mesmo slug, mesma placa.
   Uso: node tools/make-cover.js <slug>                                            */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SLUG = process.argv[2];
if (!SLUG || !/^[a-z0-9_-]+$/.test(SLUG)) {
  console.error("uso: node tools/make-cover.js <slug>");
  process.exit(2);
}

const DIR = path.join(ROOT, "pipeline", "drafts", SLUG);
const OUT_DIR = path.join(ROOT, "images", "covers");
const draftFile = path.join(DIR, "draft.json");
if (!fs.existsSync(draftFile)) {
  console.error(`não existe ${path.relative(ROOT, draftFile)} — rode write.js antes`);
  process.exit(1);
}
const draft = JSON.parse(fs.readFileSync(draftFile, "utf8"));
let brief = {};
try { brief = JSON.parse(fs.readFileSync(path.join(DIR, "brief.json"), "utf8")); } catch {}

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
const arcos = Array.from({ length: 3 }, (_, i) => {
  const r = 150 + ((h >> (i * 3)) % 9) * 26;
  return `<circle cx="${1060 - i * 30}" cy="${140 + i * 40}" r="${r}" fill="none" stroke="${cor}" stroke-width="2" opacity="${0.22 - i * 0.06}"/>`;
}).join("\n  ");

const yFinal = Math.max(300, 360 + ((4 - linhas.length) * fonte) / 2);
const corpo = linhas
  .map((l, i) => `<text x="96" y="${yFinal + i * fonte * 1.12}" font-family="Helvetica Neue, Arial, sans-serif" font-size="${fonte}" font-weight="700" fill="#F7F6F2" letter-spacing="-1">${esc(l)}</text>`)
  .join("\n  ");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img">
  <rect width="1200" height="675" fill="#0A0A0A"/>
  ${arcos}
  <rect x="0" y="0" width="14" height="675" fill="${cor}"/>
  <line x1="96" y1="120" x2="1104" y2="120" stroke="#2A2A28" stroke-width="1"/>
  <text x="96" y="96" font-family="Helvetica Neue, Arial, sans-serif" font-size="24" font-weight="700" fill="${cor}" letter-spacing="4">${esc(kicker.slice(0, 46))}</text>
  ${corpo}
  <line x1="96" y1="612" x2="1104" y2="612" stroke="#2A2A28" stroke-width="1"/>
  <text x="96" y="648" font-family="Helvetica Neue, Arial, sans-serif" font-size="19" fill="#A3A39E" letter-spacing="3">HOMEWORLDPRESS.COM</text>
  <text x="1104" y="648" text-anchor="end" font-family="Helvetica Neue, Arial, sans-serif" font-size="19" fill="${cor}" letter-spacing="2">${esc(pilar.toUpperCase())}</text>
</svg>
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
const rel = `images/covers/${SLUG}.svg`;
fs.writeFileSync(path.join(ROOT, rel), svg);

const alt = `Placa editorial do pilar ${pilar} com o título "${titulo}".`;
if (!draft.image || draft.image === rel) {
  /* A reescrita pode mudar o título depois da primeira capa: se a imagem é a
     nossa, o alt acompanha o título final junto com o SVG. */
  draft.image = rel;
  draft.imageAlt = alt;
  fs.writeFileSync(draftFile, JSON.stringify(draft, null, 2) + "\n");
  console.log(`capa criada: ${rel} (${linhas.length} linhas de título)`);
} else {
  console.log(`capa atualizada: ${rel} (o draft já tinha ${draft.image})`);
}
