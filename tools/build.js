/* build.js — preenche os feeds a partir de js/articles-db.js, entre marcadores.
   A região automática só acrescenta, no topo do feed, artigos cujo id ainda não
   aparece no resto do arquivo: cards escritos à mão nunca são tocados nem duplicados.

   Uso:
     node tools/build.js            # aplica pipeline/placements.json
     node tools/build.js --dry      # mostra o que mudaria, sem gravar
     node tools/build.js --daily    # só os blocos de rotação diária, sem tocar na capa
   Config dos slots: pipeline/placements.json                            */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DRY = process.argv.includes("--dry");
/* A rodada do cron precisa girar o bloco do dia ANTES do doctor, que exige o
   bloco de hoje no ar. Sem este modo, o build completo giraria a capa também e
   gastaria a troca da rodada antes de a matéria inédita tomar o hero. */
const DAILY = process.argv.includes("--daily");
const PLACEMENTS = path.join(ROOT, "pipeline", "placements.json");
const coverRules = require("./lib/cover-rules");
const picksRules = require("./lib/picks-rules");
const slotMarkup = require("./lib/slot-markup");

global.window = {};
require(path.join(ROOT, "js", "articles-db.js"));
const DB = global.window.HWP_DATABASE;

/* As notas vêm de pipeline/scores.json (calculadas por tools/score.js).
   Nenhum artigo do catálogo usa o campo rank, então nada é sobrescrito. */
require("./lib/catalog-notes").aplicar(DB, ROOT);

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const toTime = (s) => {
  const m = String(s || "").match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})/);
  return m ? Date.UTC(m[3], MONTHS[m[1].slice(0, 3)] - 1, m[2]) : 0;
};
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const href = (id) => `article.html?id=${encodeURIComponent(id)}`;
const thumb = (a) => a.bookCover || a.image;
/* O box vem do rascunho e vira href em página estática, onde não há app.js
   para conferir o esquema: javascript:/data: aqui seria XSS armazenado. */
const shop = (a) => {
  const url = a.affiliateBox && a.affiliateBox.amazonUrl;
  return typeof url === "string" && /^https?:\/\//i.test(url) ? url : null;
};
const minutes = (a) => String(a.readTime || "").replace(/\s*MIN(UTE)?S?\s*READ/i, "").trim() || "5";
/* O redator às vezes copia a byline da fonte ("by Fulano") para o campo author.
   O template já escreve o BY, então o prefixo sai na renderização — senão a capa
   publica "BY BY FULANO". */
const byline = (a) => esc(String(a.author || "").replace(/^\s*by\s+/i, "").trim().toUpperCase());

/* ── Templates: mesmos classes e estrutura dos cards escritos à mão ───── */
/* A placa do feed carrega o título gravado dentro dela. No hero isso sai
   duplicado, porque o H1 vem logo abaixo — então o hero usa a variante -hero
   que tools/make-cover.js escreve ao lado. Sem a variante, usa a imagem normal. */
function heroImg(a) {
  const placa = /^images\/covers\/(.+)\.svg$/.exec(a.image || "");
  if (!placa) return a.image;
  const variante = `images/covers/${placa[1]}-hero.svg`;
  return fs.existsSync(path.join(ROOT, variante)) ? variante : a.image;
}

const TEMPLATES = {
  "hero-lead": (a) => `          <article class="hero-lead">
            <a href="${href(a.id)}" class="hero-lead__media">
              <span class="hero-lead__badge">COVER STORY</span>
              <img
                src="${esc(heroImg(a))}"
                alt="${esc(heroImg(a) === a.image ? (a.imageAlt || a.title) : `Placa editorial de marca da Homeworld Press para o pilar ${a.category}.`)}"
                fetchpriority="high"
                width="960"
                height="588"
              >
            </a>

            <div>
              <span class="kicker kicker--${esc(a.category)}">${esc(a.kicker)}</span>
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
                <span>BY <strong>${byline(a)}</strong></span>
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
                  <span class="kicker kicker--${esc(a.category)}">${esc(a.kicker)}</span>
                  <h3 class="latest-item__title">
                    <a href="${href(a.id)}">${esc(a.title)}</a>
                  </h3>
                  <div class="meta-line"><span>${byline(a)}</span><span>•</span><span>${esc(a.date)}</span></div>
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
                <span class="kicker kicker--${esc(a.category)}">${esc(a.kicker)}</span>
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
              <span class="meta-line">BY <strong>${byline(a)}</strong> • ${esc(minutes(a))} MIN</span>${
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
                  <span class="kicker kicker--${esc(a.category)}">${esc(a.kicker)}</span>
                  <h3 class="compact-card__title">
                    <a href="${href(a.id)}">
                      ${esc(a.title)}
                    </a>
                  </h3>
                  <div class="meta-line"><span>${byline(a)}</span><span>•</span><span>${esc(a.readTime)}</span></div>
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
              <span class="kicker kicker--${esc(a.category)}">${esc(a.kicker)}</span>
              <h3 class="cat-feed-item__title">
                <a href="${href(a.id)}">${esc(a.title)}</a>
              </h3>
              <p class="article-card__dek">${esc(a.dek)}</p>
              <div class="meta-line" style="margin-top:0.75rem;">
                <span>BY <strong>${byline(a)}</strong></span>
                <span>•</span>${
                  shop(a)
                    ? `\n                <a href="${esc(shop(a))}" target="_blank" rel="nofollow sponsored noopener" style="color:var(--accent-wired-red-text);font-weight:700;">SHOP ON AMAZON →</a>`
                    : `\n                <span>${esc(a.date)}</span>`
                }
              </div>
            </div>
          </article>`,

  /* TODAY'S PICKS: mesma estrutura e mesmas classes dos cards escritos à mão
     que substituiu (index.html, coluna esquerda). Muda o par, não o desenho. */
  "pick-item": (a) => `            <article class="pick-item">
              <a href="${href(a.id)}" class="pick-item__media">
                <img src="${esc(thumb(a))}" alt="${esc(a.imageAlt || a.title)}" width="400" height="250">
              </a>
              <span class="kicker kicker--${esc(a.category)}">${esc(a.kicker)}</span>
              <h3 class="pick-item__title">
                <a href="${href(a.id)}">${esc(a.title)}</a>
              </h3>
              <p class="pick-item__dek">${esc(a.dek)}</p>
              <div class="meta-line">
                <span>BY <strong>${byline(a)}</strong></span>
                <span>•</span>${
                  shop(a)
                    ? `\n                <a href="${esc(shop(a))}" target="_blank" rel="nofollow sponsored noopener" style="color:var(--accent-wired-red-text);font-weight:700;">SHOP ON AMAZON →</a>`
                    : `\n                <span>${esc(a.date)}</span>`
                }
              </div>
            </article>`,

  /* Segunda e terceira peças da coluna central. Mesma classe e mesmo desenho do
     card escrito à mão que substituiu; o que muda é que agora ele sai do
     catálogo. A coluna central parada no mesmo Dune de 22/out era metade do vão
     preto que o dono apontou na home. */
  "center-subfeature": (a) => `          <article class="center-subfeature">
            <a href="${href(a.id)}" class="center-subfeature__media">
              <img src="${esc(thumb(a))}" alt="${esc(a.imageAlt || a.title)}" loading="lazy" decoding="async" width="220" height="145">
            </a>
            <div>
              <span class="kicker kicker--${esc(a.category)}">${esc(a.kicker)}</span>
              <h2 class="center-subfeature__title">
                <a href="${href(a.id)}">${esc(a.title)}</a>
              </h2>
              <div class="meta-line" style="margin-top:0.45rem;">
                <span>BY <strong>${byline(a)}</strong></span>
                <span>•</span>
                <span>${esc(a.date)}</span>
              </div>
            </div>
          </article>`,
};

function pick(slot, takenIds, ineditasPrimeiro = false) {
  /* "TODAY'S PICKS" é por dia: o mesmo acervo, começando em outro ponto da
     lista a cada dia (lib/picks-rules — a peneira, a ordem e o passo ficam lá,
     e o doctor.js confere com a mesma função). Sem isto o bloco ficou 15 dias
     com o mesmo par de 29/out e 23/out enquanto o rótulo dizia "hoje". */
  if (slot.rotacao === "dia") return picksRules.picksDoDia(picksRules.poolDePicks(DB.articles, slot, takenIds), slot.limit || 2, picksRules.diaUtc());
  /* Feed automático é por data, não por nota: a região se vende como MOST
     RECENT, e matéria de 29/10 acima de 31/10 desmente o próprio rótulo. A nota
     continua sendo a peneira da capa (pickCover) e o desempate aqui. */
  const porData = (x, y) => toTime(y.date) - toTime(x.date) || (y.rank == null ? -1 : y.rank) - (x.rank == null ? -1 : x.rank);
  const naCategoria = DB.articles.filter((a) => (slot.category ? a.category === slot.category : true));
  /* `acervo: true` no slot corta o cap: a página de editoria é o arquivo da
     editoria. Com cap fixo em 8 e 15 peças em science, 4 delas não eram listadas
     lá e 2 matérias do catálogo não tinham link de entrada em lugar nenhum —
     entre elas a do radiotelescópio no lado escondido da Lua (medido no HEAD
     09/11; o cap era o defeito, o `limit` de 8 estava na régua do doctor). */
  const recorta = (pool) => (slot.acervo ? pool : pool.slice(0, slot.limit || 6));
  if (ineditasPrimeiro) {
    /* Feed de categoria é o acervo: tem de listar as 5 peças tech que existem,
       e a curadoria do topo já mostra três delas. Descontá-las por completo —
       o comportamento antigo — deixava o tech-feed com 1 card em 8, buraco
       maior do que a repetição. A régua então é a ORDEM: inéditas primeiro,
       repetição só afunda para o fim da lista. */
    return recorta([
      ...naCategoria.filter((a) => !takenIds.has(a.id)).sort(porData),
      ...naCategoria.filter((a) => takenIds.has(a.id)).sort(porData),
    ]);
  }
  return recorta(naCategoria.filter((a) => !takenIds.has(a.id)).sort(porData));
}

/* Piso da capa: pipeline/cadence.json → cover_baseline. */
function coverFloor() {
  try {
    return coverRules.pisoDaCapa(JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "cadence.json"), "utf8")));
  } catch {
    return 0;
  }
}

/* Capa, nesta ordem:
   1. rodada já servida e a capa ainda é elegível → nada muda no hero. A trava
      vem ANTES da inédita: no dia em que a regra mudou, quase todo o acervo
      ainda não tinha passado pelo hero, e cada rebuild da mesma rodada achava
      "uma matéria nunca vista" e trocava de novo — medido com o relógio real,
      dois builds na rodada 2026-11-06T20:23, duas trocas;
   2. rodada aberta e matéria que AINDA NÃO passou pelo hero → ela toma a capa.
      É o caminho de toda publicação nova (o build chamado pelo publish.js é
      sempre o primeiro da rodada: o girarCapa() só roda quando nada foi
      publicado, e a ordem é escolha da publicação, não da rotação);
   3. rodada aberta e nada inédito → ROTACIONA: um passo na lista de elegíveis
      (`proximaNaRotação`), voltando ao topo no fim do ciclo. É a regra que faz a
      capa trocar em toda rodada do cron com matéria nova ou não — a capa é o que
      mais chama atenção e o hero não pode ficar parado entre duas rodadas.
   Se a capa registrada não está mais entre as elegíveis (nota caiu abaixo do
   piso, perdeu a foto, saiu do catálogo) a rodada é servida de novo mesmo tendo
   troca: o hero não pode continuar mostrando matéria que não pode ser capa.
   A novidade é medida por ID (lib/cover-state.jaFoiCapa), não por data:
   `a.date` do catálogo tem granularidade de dia, então "a mais nova do catálogo"
   não distingue a matéria publicada agora da que a rotação acabou de derrubar —
   era exatamente isso que desfazia a rotação no esquema antigo.
   O filtro "pode ser capa" está em lib/cover-rules, e o doctor.js usa o mesmo. */
function pickCover(forceChange = false) {
  const coverState = require("./lib/cover-state");
  const elegiveis = coverRules.elegiveis(DB, coverFloor());
  if (!elegiveis.length) return null;

  const state = coverState.loadState();
  const atual = elegiveis.find((a) => a.id === state.currentCoverId) || null;
  if (!forceChange && atual) return { artigo: atual, motivo: "mantida" };

  const inedita = elegiveis.find((a) => !coverState.jaFoiCapa(state, a.id));
  if (inedita) return { artigo: inedita, motivo: "do dia" };

  return { artigo: coverState.proximaNaRotação(elegiveis, atual && atual.id), motivo: "rotacionada" };
}

const cache = new Map();
const readSrc = (file) => {
  if (!cache.has(file)) cache.set(file, fs.readFileSync(path.join(ROOT, file), "utf8"));
  return cache.get(file);
};
const writeSrc = (file, src) => {
  cache.set(file, src);
  if (DRY) return;
  /* tmp+rename: um kill no meio do build não deixa feed truncado. O rename passa
     pelo lib/atomic-write porque no Windows o antivírus segura o alvo por um
     instante e o EPERM matava a rodada sem defeito editorial nenhum (10/11). */
  const target = path.join(ROOT, file);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, src);
  require("./lib/atomic-write").renomear(tmp, target);
};

function applySlot(file, slot) {
  let src = readSrc(file);
  const start = slotMarkup.marcador(slot.name, "start");
  const end = slotMarkup.marcador(slot.name, "end");
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
    const fallbackExists = fs.existsSync(fb);
    const resync = !fallbackExists || (incumbentId && regionIds[0] === incumbentId);
    if (!DRY && resync) {
      fs.mkdirSync(path.dirname(fb), { recursive: true });
      /* tmp + rename pelo mesmo helper do writeSrc: o fallback é a capa escrita à
         mão versionada, e truncá-lo num kill perderia a referência do dono. */
      const tmpFb = `${fb}.tmp`;
      fs.writeFileSync(tmpFb, region);
      require("./lib/atomic-write").renomear(tmpFb, fb);
    }

    /* A rodada atual já teve troca de capa? Se não, este build gira a capa. */
    const coverState = require("./lib/cover-state");
    const state = coverState.loadState();
    const rodada = coverState.rodadaId();
    const forceChange = coverState.shouldForceChange(state);

    const escolha = pickCover(forceChange) || {};
    const cover = escolha.artigo || null;
    const manual = resync ? region : fs.readFileSync(fb, "utf8");
    const content = cover ? `\n${TEMPLATES[slot.template](cover)}\n          ` : manual;
    const next = src.slice(0, i0) + content + src.slice(i1);
    if (next !== src) writeSrc(file, next);

    /* Só o build escreve o estado da capa: ele é o único que sabe qual matéria
       efetivamente foi ao ar no hero. publish.js chamava recordPublish por
       conta própria e carimbava `currentCoverId` com a matéria publicada MESMO
       quando ela não passou do piso — a rodada se declarava servida sem troca. */
    if (!DRY && cover) coverState.registrarCapa(state, cover.id, escolha.motivo, next !== src);

    return {
      file,
      slot: slot.name,
      added: cover ? 1 : 0,
      note: cover
        ? `capa ${escolha.motivo}: ${cover.id} (${cover.rank}, ${cover.date}) · piso ${coverFloor()} · rodada ${rodada}`
        : `capa manual mantida (nenhuma matéria do pipeline acima do piso ${coverFloor()})`,
    };
  }

  const after = src.slice(src.indexOf(end));
  const idsDe = (trecho) => new Set([...trecho.matchAll(/article\.html\?id=([^&"']+)/g)].map((m) => decodeURIComponent(m[1])));
  const before = src.slice(0, src.indexOf(start));
  let takenIds;
  let ineditasPrimeiro = false;
  if (slot.rotacao === "dia") {
    /* O desconto é régua do bloco, não deste arquivo: lib/picks-rules diz que
       só a região do hero desconta, e o doctor.js confere com a mesma função. */
    takenIds = picksRules.excluidasDaRotacao(src);
  } else if (slot.dedup === "prioridade-ineditas") {
    /* Página de categoria: o feed é o acervo da matéria, e o spotlight e o
       trending do topo são curadoria manual (AGENTS.md). Descontar os dois
       deixava culture-feed em 5 de 8 e tech-feed em 1 de 8 com 10 e 5 peças
       no catálogo — a régua punia a página por ela ter edição. Não descontar
       nada (a primeira tentativa, revertida pelo supervisor em 09/11) fazia o
       feed inteiro repetir a página: 8 cards de 8 apontando para algo que já
       estava no topo. A régua certa é a ORDEM, e ela olha para CIMA: o leitor
       desce, e o que ele acabou de ver no spotlight é justamente o que o
       primeiro card do feed não pode ser. Repetição existe — com 5 peças tech
       no catálogo e 3 curadas acima, não há como não repetir — mas afunda. */
    takenIds = idsDe(before);
    ineditasPrimeiro = true;
  } else if (slot.dedup === "somente-automatico") {
    /* Grade grande (CULTURE) numa página que também tem curadoria à mão: as
       duas matérias do TRENDING // TOP 5 não podem continuar tirando vaga do
       feed — com picks em 3 e o desconto do arquivo inteiro a grade caía para
       5 e abria um buraco de 437px na última linha de uma grade de 3. */
    takenIds = slotMarkup.idsDentroDasRegioes(src, slot.name);
  } else {
    takenIds = idsDe(after + before);
  }

  const cards = pick(slot, takenIds, ineditasPrimeiro).map(TEMPLATES[slot.template]);
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
  for (const slot of slots) {
    if (DAILY && slot.rotacao !== "dia") continue;
    results.push(applySlot(file, slot));
  }
}

/* O número do rótulo é consequência da grade, não escolha de quem edita o HTML:
   enquanto a CULTURE tinha cards escritos à mão, "ALL CULTURE (6)" convivia com
   9 cards no ar. doctor.js confere com o mesmo cardsNaRegiao(). */
function sincronizarContadores() {
  const linhas = [];
  for (const [file, slots] of Object.entries(config.slots)) {
    for (const slot of slots) {
      if (!slot.count_pill) continue;
      const src = readSrc(file);
      const n = slotMarkup.cardsNaRegiao(src, slot);
      const alvo = slot.count_pill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(<[^>]*${alvo}[^>]*>[^<()]*\\()\\d+(\\))`);
      if (!re.test(src)) {
        linhas.push(`${file} · ${slot.name}: pill "${slot.count_pill}" não encontrada — nada feito`);
        continue;
      }
      const next = src.replace(re, `$1${n}$2`);
      if (next !== src) writeSrc(file, next);
      linhas.push(`${file} · ${slot.name}: pill ${n}`);
    }
  }
  return linhas;
}

if (!DAILY) for (const linha of sincronizarContadores()) console.log(linha);
for (const r of results) console.log(`${r.file} · ${r.slot}: +${r.added}${r.note ? ` (${r.note})` : ""}`);
console.log(DRY ? "(dry run — nada gravado)" : DAILY ? "rotação diária aplicada (capa intacta)." : "build aplicado.");
