/* build.js — preenche os feeds a partir de js/articles-db.js, entre marcadores.
   A região automática só acrescenta, no topo do feed, artigos cujo id ainda não
   aparece no resto do arquivo: cards escritos à mão nunca são tocados nem duplicados.

   Uso:
     node tools/build.js            # aplica pipeline/placements.json
     node tools/build.js --dry      # mostra o que mudaria, sem gravar
   Config dos slots: pipeline/placements.json                            */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DRY = process.argv.includes("--dry");
const PLACEMENTS = path.join(ROOT, "pipeline", "placements.json");

global.window = {};
require(path.join(ROOT, "js", "articles-db.js"));
const DB = global.window.HWP_DATABASE;

/* As notas vêm de pipeline/scores.json (calculadas por tools/score.js).
   Nenhum artigo do catálogo usa o campo rank, então nada é sobrescrito.
   rankSource === "baseline" marca o acervo anterior ao pipeline: essas
   matérias competem no feed, mas nunca viram capa gerada — o HTML escrito à
   mão delas carrega detalhes (dek, alt, botão) que o catálogo não tem. */
try {
  const store = JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "scores.json"), "utf8"));
  for (const a of DB.articles) {
    const rec = (store.scores || {})[a.id];
    if (rec && typeof rec.score === "number") { a.rank = rec.score; a.rankNote = rec.note || ""; a.rankSource = rec.source || "auto"; }
  }
} catch {}

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const toTime = (s) => {
  const m = String(s || "").match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})/);
  return m ? Date.UTC(m[3], MONTHS[m[1].slice(0, 3)] - 1, m[2]) : 0;
};
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const href = (id) => `article.html?id=${encodeURIComponent(id)}`;
const thumb = (a) => a.bookCover || a.image;
const shop = (a) => (a.affiliateBox && a.affiliateBox.amazonUrl) || null;
const minutes = (a) => String(a.readTime || "").replace(/\s*MIN(UTE)?S?\s*READ/i, "").trim() || "5";

/* ── Templates: mesmos classes e estrutura dos cards escritos à mão ───── */
const TEMPLATES = {
  "hero-lead": (a) => `          <article class="hero-lead">
            <a href="${href(a.id)}" class="hero-lead__media">
              <span class="hero-lead__badge">COVER STORY // ${esc(String(a.kicker || "").split("//").pop().trim() || "HOMEWORLD PRESS")}</span>
              <img
                src="${esc(a.image)}"
                alt="${esc(a.imageAlt || a.title)}"
                fetchpriority="high"
                width="960"
                height="588"
              >
            </a>

            <div>
              <span class="kicker kicker--${a.category}">${esc(a.kicker)}</span>
              <h1 class="hero-lead__title">
                <a href="${href(a.id)}">
                  ${esc(a.title)}
                </a>
              </h1>
            </div>

            <p class="hero-lead__dek">
              ${esc(a.dek)}
            </p>

            <div class="meta-line" style="justify-content:space-between;flex-wrap:wrap;padding-top:0.4rem;">
              <div>
                <span>BY <strong>${esc(String(a.author || "").toUpperCase())}</strong></span>
                <span> • </span>
                <span>${esc(String(a.date).toUpperCase())}</span>
                <span> • </span>
                <span>${esc(a.readTime)}</span>
              </div>
              <div style="display:flex;gap:0.65rem;flex-wrap:wrap;">
                <a href="${href(a.id)}" class="btn-secondary-dark" style="padding:0.42rem 0.85rem;">READ FULL STORY →</a>${
                shop(a)
                  ? `\n                <a href="${esc(shop(a))}" target="_blank" rel="nofollow sponsored noopener" class="btn-amazon" style="width:auto;padding:0.42rem 0.9rem;">SHOP ON AMAZON →</a>`
                  : ""
              }
              </div>
            </div>
          </article>`,

  "latest-item": (a) => `              <article class="latest-item">
                <div>
                  <span class="kicker kicker--${a.category}">${esc(a.kicker)}</span>
                  <h3 class="latest-item__title">
                    <a href="${href(a.id)}">${esc(a.title)}</a>
                  </h3>
                  <div class="meta-line"><span>${esc(String(a.author || "").toUpperCase())}</span><span>•</span><span>${esc(a.date)}</span></div>
                </div>
${
                thumb(a)
                  ? `
                <a href="${href(a.id)}">
                  <img src="${esc(thumb(a))}" alt="${esc(a.imageAlt || a.title)}" class="latest-item__thumb" width="76" height="76">
                </a>`
                  : ""
              }
              </article>`,

  "article-card": (a) => `          <article class="article-card" data-culture-card data-subtopic="${esc(a.subtopic)}">
            <div>
${
                a.image
                  ? `
                <a href="${href(a.id)}" class="article-card__media">
                <img src="${esc(a.image)}" alt="${esc(a.imageAlt || a.title)}" loading="lazy" decoding="async" width="420" height="260">
              </a>`
                  : ""
              }
              <div class="article-card__body">
                <span class="kicker kicker--${a.category}">${esc(a.kicker)}</span>
                <h3 class="article-card__title">
                  <a href="${href(a.id)}">
                    ${esc(a.title)}
                  </a>
                </h3>
                <p class="article-card__excerpt">
                  ${esc(a.dek)}
                </p>
              </div>
            </div>
            <div class="article-card__footer">
              <span class="meta-line">BY <strong>${esc(String(a.author || "").toUpperCase())}</strong> • ${esc(minutes(a))} MIN</span>${
                shop(a)
                  ? `\n              <a href="${esc(shop(a))}" target="_blank" rel="nofollow sponsored noopener" style="font-family:var(--font-mono);font-size:0.72rem;font-weight:700;color:var(--accent-wired-red-text);">
                SHOP ON AMAZON →
              </a>`
                  : ""
              }
            </div>
          </article>`,

  "compact-card": (a) => `              <article class="compact-card">
${
                a.image
                  ? `
                <a href="${href(a.id)}">
                  <img src="${esc(a.image)}" alt="${esc(a.imageAlt || a.title)}" class="compact-card__img" loading="lazy" decoding="async" width="130" height="96">
                </a>`
                  : ""
              }
                <div>
                  <span class="kicker kicker--${a.category}">${esc(a.kicker)}</span>
                  <h3 class="compact-card__title">
                    <a href="${href(a.id)}">
                      ${esc(a.title)}
                    </a>
                  </h3>
                  <div class="meta-line"><span>${esc(String(a.author || "").toUpperCase())}</span><span>•</span><span>${esc(a.readTime)}</span></div>
                </div>
              </article>`,

  "cat-feed-item": (a) => `          <article class="cat-feed-item" data-culture-card data-subtopic="${esc(a.subtopic)}">
${
            a.image
              ? `
            <a href="${href(a.id)}" class="cat-feed-item__media">
              <img src="${esc(a.image)}" alt="${esc(a.imageAlt || a.title)}" loading="lazy" width="280" height="185">
            </a>`
              : ""
          }
            <div>
              <span class="kicker kicker--${a.category}">${esc(a.kicker)}</span>
              <h3 class="cat-feed-item__title">
                <a href="${href(a.id)}">${esc(a.title)}</a>
              </h3>
              <p class="article-card__dek">${esc(a.dek)}</p>
              <div class="meta-line" style="margin-top:0.75rem;">
                <span>BY <strong>${esc(String(a.author || "").toUpperCase())}</strong></span>
                <span>•</span>${
                  shop(a)
                    ? `\n                <a href="${esc(shop(a))}" target="_blank" rel="nofollow sponsored noopener" style="color:var(--accent-wired-red-text);font-weight:700;">SHOP ON AMAZON →</a>`
                    : `\n                <span>${esc(a.date)}</span>`
                }
              </div>
            </div>
          </article>`,
};

function pick(slot, takenIds) {
  const pool = DB.articles
    .filter((a) => (slot.category ? a.category === slot.category : true))
    .filter((a) => !takenIds.has(a.id))
    .sort((x, y) => (y.rank == null ? -1 : y.rank) - (x.rank == null ? -1 : x.rank) || toTime(y.date) - toTime(x.date));
  return pool.slice(0, slot.limit || 6);
}

function pickCover() {
  const scored = DB.articles
    .filter((a) => typeof a.rank === "number" && a.rankSource !== "baseline" && a.image)
    .sort((x, y) => y.rank - x.rank || toTime(y.date) - toTime(x.date));
  const best = scored[0] || null;
  /* Uma matéria nova só toma a capa se vencer a nota de base da capa vigente. */
  const incumbent = DB.articles.find((a) => a.rankSource === "baseline" && typeof a.rank === "number");
  if (best && incumbent && best.rank <= incumbent.rank) return null;
  return best;
}

const cache = new Map();
const readSrc = (file) => {
  if (!cache.has(file)) cache.set(file, fs.readFileSync(path.join(ROOT, file), "utf8"));
  return cache.get(file);
};
const writeSrc = (file, src) => {
  cache.set(file, src);
  if (!DRY) fs.writeFileSync(path.join(ROOT, file), src);
};

function applySlot(file, slot) {
  let src = readSrc(file);
  const start = `<!-- hwp:auto:${slot.name}:start -->`;
  const end = `<!-- hwp:auto:${slot.name}:end -->`;
  let inserted = false;

  if (!src.includes(start)) {
    const open = new RegExp(`(<${slot.container.tag}\\b[^>]*class="[^"]*\\b${slot.container.class}\\b[^"]*"[^>]*>)`);
    const m = src.match(open);
    if (!m) return { file, slot: slot.name, added: 0, note: "container não encontrado — nada feito" };
    src = src.replace(m[0], `${m[0]}\n${start}\n${end}`);
    inserted = true;
  }

  if (slot.mode === "replace") {
    const i0 = src.indexOf(start) + start.length;
    const i1 = src.indexOf(end);
    const region = src.slice(i0, i1);
    const fb = path.join(ROOT, slot.fallback);
    const incumbentId = (DB.articles.find((a) => a.rankSource === "baseline" && a.isHeroLead) || {}).id || null;
    const regionIds = [...region.matchAll(/article\.html\?id=([^&"']+)/g)].map((m) => decodeURIComponent(m[1]));
    /* O fallback guarda a capa escrita à mão. Ele é ressincronizado sempre que a
       região atual é a capa manual — assim uma edição sua no HTML vira a nova
       referência, e uma capa gerada nunca contamina o fallback. */
    if (!fs.existsSync(fb) || (incumbentId && regionIds[0] === incumbentId)) {
      fs.mkdirSync(path.dirname(fb), { recursive: true });
      fs.writeFileSync(fb, region);
    }
    const cover = pickCover();
    const content = cover ? `\n${TEMPLATES[slot.template](cover)}\n          ` : fs.readFileSync(fb, "utf8");
    const next = src.slice(0, i0) + content + src.slice(i1);
    if (next !== src) writeSrc(file, next);
    return {
      file,
      slot: slot.name,
      added: cover ? 1 : 0,
      note: cover
        ? `capa por nota: ${cover.id} (${cover.rank})`
        : `capa manual mantida (nenhuma matéria venceu a nota de base ${incumbentId ? DB.articles.find((a) => a.id === incumbentId).rank : "?"})`,
    };
  }

  const after = src.slice(src.indexOf(end));
  const takenIds = new Set([...after.matchAll(/article\.html\?id=([^&"']+)/g)].map((m) => decodeURIComponent(m[1])));
  const before = src.slice(0, src.indexOf(start));
  for (const m of before.matchAll(/article\.html\?id=([^&"']+)/g)) takenIds.add(decodeURIComponent(m[1]));

  const cards = pick(slot, takenIds).map(TEMPLATES[slot.template]);
  const block = cards.length ? `\n${cards.join("\n\n")}\n` : "\n";
  const next = `${before}${start}${block}${end}${after.slice(end.length)}`;
  if (inserted || next !== src) {
    writeSrc(file, next);
    return { file, slot: slot.name, added: cards.length, note: inserted ? "marcadores instalados" : undefined };
  }
  return { file, slot: slot.name, added: 0 };
}

const config = JSON.parse(fs.readFileSync(PLACEMENTS, "utf8"));
const results = [];
for (const [file, slots] of Object.entries(config.slots)) {
  for (const slot of slots) results.push(applySlot(file, slot));
}
for (const r of results) console.log(`${r.file} · ${r.slot}: +${r.added}${r.note ? ` (${r.note})` : ""}`);
console.log(DRY ? "(dry run — nada gravado)" : "build aplicado.");
