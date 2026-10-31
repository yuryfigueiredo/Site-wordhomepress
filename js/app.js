/* ==========================================================================
   HOMEWORLD PRESS — INTERACTIVE EDITORIAL ENGINE (js/app.js v2)
   ========================================================================== */

(function () {
  "use strict";

  const DB = window.HWP_DATABASE;

  /* Títulos de fonte vêm de feed de terceiro: entram como texto, nunca como HTML. */
  const escapeHtml = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  /* Só http(s) e caminho relativo viram href: javascript:/data: num campo do
     catálogo (que nasce de feed de terceiro) viraria link executável.
     A checagem descarta espaço e caractere de controle antes de olhar o
     esquema: "  java\tscript:" é o mesmo esquema e passava pela âncora ^. */
  const safeHref = (u) => {
    const raw = String(u || "");
    const probe = raw.replace(/[\u0000-\u0020\u007f]/g, "");
    return /^[a-z][a-z0-9+.-]*:/i.test(probe) && !/^https?:/i.test(probe) ? "" : raw;
  };

  /* Segunda camada: o corpo da matéria é HTML de confiança e entra como veio.
     Depois de montado, o navegador já normalizou entidades e tabs, então
     conferir a.protocol pega o que um regex no texto deixaria passar. */
  function neutralizeLinks(root) {
    root.querySelectorAll("a[href]").forEach((a) => {
      if (!/^(https?|mailto|tel):$/.test(a.protocol)) a.removeAttribute("href");
    });
  }

  const asArray = (x) => (Array.isArray(x) ? x : []);

  /* O corpo sai do pipeline como HTML, e o portão do redator é a única defesa
     lá atrás. Aqui o HTML é reconstruído a partir do que pode existir — uma
     lista de proibidos em cima de DOMParser deixa passar <template>/<noscript>
     e variantes de mXSS, e um <img onerror> do catálogo executa na montagem. */
  const ALLOWED_ELEMENTS = new Set(["P", "H2", "H3", "H4", "UL", "OL", "LI", "BLOCKQUOTE", "STRONG", "EM", "B", "I", "A", "BR", "HR", "CODE", "PRE"]);
  const DROP_ELEMENTS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "IMG", "SVG", "MATH", "LINK", "META", "BASE", "TEMPLATE", "NOSCRIPT", "FRAME", "FRAMESET", "APPLET", "PARAM", "MARQUEE", "AUDIO", "VIDEO", "SOURCE", "TRACK", "CANVAS", "INPUT", "BUTTON", "SELECT", "TEXTAREA"]);
  const SAFE_ATTRIBUTES = new Set(["href", "title", "rel", "target"]);
  function sanitizeRichHtml(html) {
    const doc = new DOMParser().parseFromString(`<div>${String(html || "")}</div>`, "text/html");
    const clean = (node) => {
      for (const child of [...node.children]) {
        if (DROP_ELEMENTS.has(child.tagName)) {
          child.remove();
          continue;
        }
        clean(child);
        if (!ALLOWED_ELEMENTS.has(child.tagName)) {
          child.replaceWith(...child.childNodes);
          continue;
        }
        [...child.attributes].forEach((attr) => {
          if (!SAFE_ATTRIBUTES.has(attr.name.toLowerCase())) child.removeAttribute(attr.name);
        });
      }
    };
    clean(doc.body);
    return doc.body.innerHTML;
  }

  /* Id inexistente não pode cair na matéria mais nova: isso cria infinitas
     URLs duplicadas com o mesmo conteúdo e confunde quem chega por link velho.
     O estado é de não encontrado e a página pede para não ser indexada. */
  function renderNotFound(holder, kind) {
    document.title = "Not found | Homeworld Press";
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute("content", "The page you asked for isn't here.");
    setNoindex();
    /* O shell da resenha traz um Product de exemplo: sem apagar, a página de
       não encontrada anuncia estrelas e preço de um produto qualquer. */
    document.querySelectorAll('script[type="application/ld+json"]').forEach((tag) => tag.remove());
    holder.innerHTML = `
      <div class="article-header">
        <span class="kicker">404 // NOT FOUND</span>
        <h1 class="article-title">${kind === "review" ? "That buyer’s guide isn’t here." : "That story isn’t here."}</h1>
        <p class="article-dek">The link may be old or mistyped. <a href="index.html">Go back to the front page</a> or <a href="reviews.html">browse the buyer’s guides</a>.</p>
      </div>`;
  }

  /* Safari privado, Chrome com storage bloqueado e iframe de terceiro lançam
     ao tocar em localStorage. Sem a guarda, o erro matava o arquivo inteiro e
     a página do artigo ficava em branco. */
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch {} },
    remove(key) { try { localStorage.removeItem(key); } catch {} },
  };

  // 1. Theme Persistence (Editorial Paper vs. WIRED Dark Mode)
  function initTheme() {
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const saved = store.get("hwp_theme") || (prefersDark ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", saved);
    updateThemeButtons(saved);

    document.querySelectorAll("[data-action='toggle-theme']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const current = document.documentElement.getAttribute("data-theme") || "light";
        const next = current === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        store.set("hwp_theme", next);
        updateThemeButtons(next);
      });
    });
  }

  function updateThemeButtons(theme) {
    document.querySelectorAll("[data-action='toggle-theme']").forEach((btn) => {
      btn.textContent = theme === "dark" ? "☀ PAPER" : "◐ DARK";
      btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
    });
  }

  // 2. Sub-Stream Filtering on Homepage & Category Pages
  function initCultureFilter() {
    const pills = document.querySelectorAll("[data-culture-filter]");
    const cards = document.querySelectorAll("[data-culture-card]");
    if (!pills.length || !cards.length) return;

    const syncPressed = (activePill) => {
      pills.forEach((p) =>
        p.setAttribute("aria-pressed", p === activePill ? "true" : "false")
      );
    };
    syncPressed(
      Array.from(pills).find((p) => p.classList.contains("is-active")) || pills[0]
    );

    pills.forEach((pill) => {
      pill.addEventListener("click", () => {
        const filter = pill.getAttribute("data-culture-filter");
        pills.forEach((p) => p.classList.remove("is-active"));
        pill.classList.add("is-active");
        syncPressed(pill);

        cards.forEach((card) => {
          const sub = card.getAttribute("data-subtopic");
          const defaultDisplay = card.classList.contains("cat-feed-item") ? "grid" : "flex";
          if (filter === "all" || sub === filter) {
            card.style.display = defaultDisplay;
          } else {
            card.style.display = "none";
          }
        });
      });
    });
  }

  // 3. Native <dialog> Live Search Modal
  function initSearchModal() {
    const dialog = document.getElementById("searchDialog");
    const openBtns = document.querySelectorAll("[data-action='open-search']");
    const closeBtn = document.getElementById("closeSearchBtn");
    const input = document.getElementById("searchInput");
    const resultsBox = document.getElementById("searchResults");

    if (!dialog) return;

    openBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        dialog.showModal();
        if (input) {
          input.focus();
          renderSearchResults("");
        }
      });
    });

    if (closeBtn) {
      closeBtn.addEventListener("click", () => dialog.close());
    }

    dialog.addEventListener("click", (e) => {
      const rect = dialog.getBoundingClientRect();
      const clickedOutside =
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom;
      if (clickedOutside) dialog.close();
    });

    if (input && resultsBox && DB) {
      input.addEventListener("input", (e) => {
        renderSearchResults(e.target.value.trim().toLowerCase());
      });
    }

    function renderSearchResults(query) {
      if (!resultsBox || !DB) return;
      const prefix = window.location.pathname.includes("/dumarest/") ? "../" : "";
      const archiveItems = [
        {
          title: "E.C. Tubb’s Dumarest of Terra Complete Cover Artwork Archive & Vol. 33 Child of Earth",
          kicker: "ARCHIVE // OFFICIAL IMPRINT",
          url: `${prefix}dumarest/index.htm`
        },
        {
          title: "Edgar Rice Burroughs’ Tarzan Centennial Edition (Illustrated by Sal Amendola, ISBN 978-0985928407)",
          kicker: "ARCHIVE // CENTENNIAL EDITION",
          url: `${prefix}tarzan-centennial.html`
        },
        {
          title: "James Gauthier’s Bishop Chance Adventures, Earth Shock Trilogy & A Pack of Trouble",
          kicker: "ARCHIVE // ILLUSTRATED FICTION",
          url: `${prefix}chance.htm`
        },
        {
          title: "Leonard Starr’s Mary Perkins On Stage & Classic American Comic Strip Archive",
          kicker: "ARCHIVE // CLASSIC COMICS",
          url: `${prefix}classic-comics.html`
        }
      ];

      const allItems = [
        ...DB.articles.map((a) => ({
          title: a.title,
          kicker: a.kicker,
          url: `${prefix}article.html?id=${encodeURIComponent(a.id)}`
        })),
        ...DB.reviews.map((r) => ({
          title: r.title,
          kicker: r.kicker,
          url: `${prefix}review.html?id=${encodeURIComponent(r.id)}`
        })),
        ...archiveItems
      ];

      const matches = query
        ? allItems.filter(
            (item) =>
              item.title.toLowerCase().includes(query) ||
              item.kicker.toLowerCase().includes(query)
          )
        : allItems.slice(0, 7);

      if (!matches.length) {
        resultsBox.innerHTML = `<p style="font-family:var(--font-mono);font-size:0.82rem;color:var(--text-muted);padding:0.75rem 0;">No matching articles or archive editions found.</p>`;
        return;
      }

      resultsBox.innerHTML = matches
        .map(
          (m) => `
        <a href="${escapeHtml(safeHref(m.url))}" class="search-result-link">
          <div class="kicker" style="font-size:0.65rem;">${escapeHtml(m.kicker)}</div>
          <div style="font-family:var(--font-display);font-weight:800;font-size:1rem;margin-top:0.2rem;">${escapeHtml(m.title)}</div>
        </a>
      `
        )
        .join("");
    }
  }

  // 4. Dynamic Article Reader Page (article.html?id=...)
  function initArticleReader() {
    const holder = document.getElementById("dynamicArticleMount");
    if (!holder || !DB) return;

    const params = new URLSearchParams(window.location.search);
    /* data-id: nas cópias a-<id>.html o id vem do atributo, porque a URL é
       /article.html?id=... só quando passa pela rewrite do vercel.json. */
    const id = params.get("id") || holder.dataset.id || null;
    /* Sem ?id= a página abre a matéria mais recente (link legado /article);
       com ?id= errado é 404 de verdade — antes ela mostrava a mais recente
       e o Google indexava a URL quebrada com o texto de outra matéria. */
    const article = DB.articles.find((a) => a.id === id) || (id ? null : DB.articles[0]);
    if (!article) {
      renderNotFound(holder, "article");
      return;
    }

    document.title = `${article.title} | Homeworld Press`;
    const desc = document.querySelector('meta[name="description"]');
    if (desc && article.dek) desc.setAttribute("content", article.dek);

    /* O breadcrumb é estático no HTML; sem isto toda matéria de ciência
       aparecia como "Culture / Buyer's Guides". */
    const SUBTOPIC_LABEL = { authors: "Authors", news: "News", comics: "Comics", guides: "Guides", concepts: "Concepts", space: "Space" };
    const category = String(article.category || "");
    const crumbCat = document.getElementById("crumbCategory");
    if (crumbCat) {
      crumbCat.textContent = category.charAt(0).toUpperCase() + category.slice(1);
      crumbCat.setAttribute("href", `${category}.html`);
    }
    const crumbSub = document.getElementById("crumbSubtopic");
    if (crumbSub) {
      crumbSub.textContent = SUBTOPIC_LABEL[article.subtopic] || "Articles";
      crumbSub.setAttribute("href", `${category}.html`);
    }

    // Highlight active category link in the top bar
    document.querySelectorAll(".wired-nav__link").forEach((link) => {
      const href = link.getAttribute("href") || "";
      if (href === `${article.category}.html`) {
        link.classList.add("is-active");
      } else {
        link.classList.remove("is-active");
      }
    });

    const box = article.affiliateBox;
    /* Post novo chega com affiliateBox: null; sem esta guarda a página inteira
       fica em branco, porque o acesso a box.pros lançava antes do innerHTML. */
    let verdictHtml = "";
    if (box) {
      const prosHtml = asArray(box.pros).map((p) => `<li>✓ ${escapeHtml(p)}</li>`).join("");
      const consHtml = asArray(box.cons).map((c) => `<li>✕ ${escapeHtml(c)}</li>`).join("");
      const verdictImg = article.bookCover || article.image;
      const verdictImgFit = article.bookCover ? "contain" : "cover";
      const isExternalSecondary = /^https?:\/\//i.test(box.audibleUrl || "");
      /* Nem todo box aponta para a Amazon: um deles manda para a própria
         resenha. Link interno com target/rel de afiliado e rótulo "Amazon"
         era uma promessa falsa. */
      const isExternalPrimary = /^https?:\/\//i.test(box.amazonUrl || "");
      verdictHtml = `
      <!-- High-Converting WIRED + Wirecutter Affiliate Verdict Box -->
      <div class="verdict-box">
        <div class="verdict-box__ribbon">
          <span>★ ${escapeHtml(box.badge)}</span>
          <span>SCORE: ${escapeHtml(box.score)}</span>
        </div>
        <div class="verdict-box__inner">
          <img src="${escapeHtml(verdictImg || "")}" alt="${escapeHtml(box.title || article.title)}" style="width:100%;height:165px;object-fit:${verdictImgFit};background:#0d0d0d;border:var(--border-hairline);">
          <div>
            <h2 style="font-family:var(--font-display);font-size:1.3rem;font-weight:900;margin-bottom:0.35rem;">${escapeHtml(box.title)}</h2>
            <p style="font-family:var(--font-mono);font-size:0.8rem;color:var(--text-muted);margin-bottom:0.85rem;">ESTIMATED PRICE: <strong>${escapeHtml(box.price)}</strong></p>
            <div style="display:flex;flex-wrap:wrap;gap:0.65rem;">
              <a href="${escapeHtml(safeHref(box.amazonUrl || ""))}" ${isExternalPrimary ? 'target="_blank" rel="nofollow sponsored noopener"' : ""} class="btn-amazon" style="width:auto;padding:0.65rem 1.25rem;">${isExternalPrimary ? "CHECK PRICE ON AMAZON →" : "SEE OUR TESTED GUIDE →"}</a>
              <a href="${escapeHtml(safeHref(box.audibleUrl || ""))}" ${isExternalSecondary ? 'target="_blank" rel="nofollow sponsored noopener"' : ""} class="btn-secondary-dark" style="background:#111;color:#fff;padding:0.65rem 1.1rem;">TRY ON AUDIBLE / MORE →</a>
            </div>
          </div>
        </div>
        <div class="verdict-box__pros-cons" style="padding:0 1.5rem 1.25rem;">
          <div>
            <strong class="verdict-label verdict-label--pros">WHY WE RECOMMEND IT</strong>
            <ul style="list-style:none;margin-top:0.4rem;display:flex;flex-direction:column;gap:0.3rem;">${prosHtml}</ul>
          </div>
          <div>
            <strong class="verdict-label verdict-label--cons">KEEP IN MIND</strong>
            <ul style="list-style:none;margin-top:0.4rem;display:flex;flex-direction:column;gap:0.3rem;">${consHtml}</ul>
          </div>
        </div>
      </div>`;
    }

    const sources = Array.isArray(article.sources)
      ? article.sources.filter((s) => s && /^https?:\/\//i.test(s.url || ""))
      : [];
    const sourcesHtml = sources.length
      ? `
      <section class="article-sources">
        <h2 class="article-sources__title">Sources</h2>
        <ol>
          ${sources
            .map(
              (s) =>
                `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title || s.url)}</a>${
                  s.date ? ` <span class="article-sources__date">${escapeHtml(s.date)}</span>` : ""
                }</li>`
            )
            .join("")}
        </ol>
      </section>`
      : "";

    holder.innerHTML = `
      <div class="article-header">
        <span class="kicker kicker--${escapeHtml(article.category)}">${escapeHtml(article.kicker)}</span>
        <h1 class="article-title">${escapeHtml(article.title)}</h1>
        <p class="article-dek">${escapeHtml(article.dek)}</p>
        <div class="meta-line">
          <span>BY <strong>${escapeHtml(article.author)}</strong></span>
          <span>•</span>
          <span>${escapeHtml(article.date)}</span>
          <span>•</span>
          <span>${escapeHtml(article.readTime)}</span>
        </div>
      </div>

      ${article.image ? `<figure style="margin-bottom:2rem;border:var(--border-hairline);">
        <img src="${escapeHtml(article.image)}" alt="${escapeHtml(article.imageAlt || article.title)}" fetchpriority="high" width="900" height="500" style="width:100%;max-height:480px;object-fit:cover;">
      </figure>` : ""}

      ${verdictHtml}

      <div class="article-prose">
        ${sanitizeRichHtml(article.content)}
      </div>

      ${sourcesHtml}

      <div class="ad-slot-container">
        <div class="ad-slot-container__label">ADVERTISEMENT // GOOGLE ADSENSE & MEDIAVINE DISPLAY SLOT (ZERO-CLS RESERVED)</div>
        <div style="font-family:var(--font-mono);font-size:0.78rem;color:var(--text-secondary);">728x90 / Responsive In-Article Unit — High-RPM US Literature & Tech Contextual Placement</div>
      </div>
    `;
    neutralizeLinks(holder);
  }

  // 5. Buyer's Guide page (review.html?id=...) — dynamically populate full guide, comparison matrix, and tested picks
  function initReviewPage() {
    const mount = document.getElementById("dynamicReviewMount");
    if (!mount || !DB || !Array.isArray(DB.reviews)) return;

    const id = new URLSearchParams(window.location.search).get("id") || mount.dataset.id || null;
    const review = DB.reviews.find((r) => r.id === id) || (id ? null : DB.reviews[0]);
    if (!review) {
      renderNotFound(mount, "review");
      return;
    }

    document.title = `${review.title} | Homeworld Press Hardware Lab`;
    const desc = document.querySelector('meta[name="description"]');
    if (desc && review.summary) desc.setAttribute("content", review.summary);

    const prosHtml = asArray(review.pros).map((p) => `<li>✓ ${escapeHtml(p)}</li>`).join("");
    const consHtml = asArray(review.cons).map((c) => `<li>✕ ${escapeHtml(c)}</li>`).join("");

    const matrixRowsHtml = asArray(review.matrixRows)
      .map(
        (row) => `
      <tr>
        <th scope="row">${escapeHtml(row.model)}</th>
        <td>${escapeHtml(row.bestFor)}</td>
        <td>${escapeHtml(row.spec)}</td>
        <td><strong>${escapeHtml(row.score)}</strong></td>
        <td><a href="${escapeHtml(safeHref(row.url))}" target="_blank" rel="nofollow sponsored noopener" class="btn-amazon" style="padding:0.4rem 0.7rem;width:auto;">AMAZON →</a></td>
      </tr>
    `
      )
      .join("");

    const secondaryPicksHtml = asArray(review.secondaryPicks)
      .map(
        (pick) => `
      <div class="verdict-box">
        <div class="verdict-box__ribbon">
          <span>${escapeHtml(pick.ribbon)}</span>
          <span>HOMEWORLD SCORE: ${escapeHtml(pick.score)}</span>
        </div>
        <div class="verdict-box__inner">
          <img src="${escapeHtml(safeHref(pick.image))}" alt="${escapeHtml(pick.title)}" loading="lazy" width="200" height="180" style="width:100%;height:170px;object-fit:cover;border:var(--border-hairline);" />
          <div>
            <h2 style="font-family:var(--font-display);font-size:1.45rem;font-weight:900;margin:0 0 0.35rem;border:none;padding:0;">
              ${escapeHtml(pick.title)}
            </h2>
            <p style="font-size:0.93rem;color:var(--text-secondary);margin-bottom:0.85rem;">
              ${escapeHtml(pick.summary)}
            </p>
            <a href="${escapeHtml(safeHref(pick.url))}" target="_blank" rel="nofollow sponsored noopener" class="btn-amazon" style="width:auto;padding:0.7rem 1.25rem;">
              ${escapeHtml(pick.ctaText)}
            </a>
          </div>
        </div>
      </div>
    `
      )
      .join("");

    mount.innerHTML = `
      <div class="article-header">
        <span class="kicker kicker--reviews" id="reviewKicker">${escapeHtml(review.kicker)}</span>
        <h1 class="article-title" id="reviewTitle">${escapeHtml(review.title)}</h1>
        <p class="article-dek" id="reviewDek">${escapeHtml(review.summary)}</p>
        <div class="meta-line">
          <span>BY <strong>HOMEWORLD PRESS LAB TEAM</strong></span>
          <span>•</span>
          <span>${escapeHtml(review.updated || "UPDATED OCTOBER 2026")}</span>
          <span>•</span>
          <span>${escapeHtml(review.readTime || "10 MIN READ")}</span>
        </div>
      </div>

      <!-- Pick 1: Best Overall -->
      <div class="verdict-box" id="reviewLead">
        <div class="verdict-box__ribbon">
          <span id="reviewLeadAward">🏆 #1 ${escapeHtml(review.award)} (2026)</span>
          <span id="reviewLeadScore">HOMEWORLD SCORE: ${escapeHtml(String(review.score).replace("/", " / "))}</span>
        </div>
        <div class="verdict-box__inner">
          <img src="${escapeHtml(safeHref(review.image))}" id="reviewLeadImg" alt="${escapeHtml(review.topPickName)}" fetchpriority="high" width="200" height="180" style="width:100%;height:170px;object-fit:cover;border:var(--border-hairline);" />
          <div>
            <h2 id="reviewLeadName" style="font-family:var(--font-display);font-size:1.45rem;font-weight:900;margin:0 0 0.35rem;border:none;padding:0;">
              ${escapeHtml(review.topPickName)}
            </h2>
            <p id="reviewLeadSummary" style="font-size:0.93rem;color:var(--text-secondary);margin-bottom:0.85rem;">
              <strong>Estimated Price Range: ${escapeHtml(review.priceRange)}.</strong> ${escapeHtml(review.summary)}
            </p>
            <div style="display:flex;flex-wrap:wrap;gap:0.65rem;">
              <a href="${escapeHtml(safeHref(review.amazonUrl))}" target="_blank" rel="nofollow sponsored noopener" id="reviewLeadCta" class="btn-amazon" style="width:auto;padding:0.7rem 1.25rem;">
                CHECK PRICE ON AMAZON US →
              </a>
              <a href="${escapeHtml(safeHref(review.secondaryCtaUrl || "https://www.amazon.com/hz/audible/mlp/membership/plus?tag=homeworldpres-20"))}" target="_blank" rel="nofollow sponsored noopener" class="btn-secondary-dark" style="background:#111;color:#fff;width:auto;padding:0.7rem 1.1rem;">
                ${escapeHtml(review.secondaryCtaText || "TRY AUDIBLE FREE →")}
              </a>
            </div>
          </div>
        </div>
        <div class="verdict-box__pros-cons" id="reviewLeadProsCons" style="padding:0 1.5rem 1.25rem;">
          <div>
            <strong class="verdict-label verdict-label--pros">PROS</strong>
            <ul style="list-style:none;margin-top:0.35rem;display:flex;flex-direction:column;gap:0.25rem;">${prosHtml}</ul>
          </div>
          <div>
            <strong class="verdict-label verdict-label--cons">CONS</strong>
            <ul style="list-style:none;margin-top:0.35rem;display:flex;flex-direction:column;gap:0.25rem;">${consHtml}</ul>
          </div>
        </div>
      </div>

      <!-- Side-by-Side Comparison Matrix -->
      <div class="article-prose">
        <h2>${escapeHtml(review.matrixTitle)}</h2>
        <div tabindex="0" role="region" aria-labelledby="ereader-matrix-caption" class="table-wrapper" style="margin-block:1.5rem;">
          <table class="comparison-table">
            <caption id="ereader-matrix-caption">
              ${escapeHtml(review.matrixCaption)}
            </caption>
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Best For</th>
                <th scope="col">Display / Spec</th>
                <th scope="col">Lab Score</th>
                <th scope="col">Check Price</th>
              </tr>
            </thead>
            <tbody>
              ${matrixRowsHtml}
            </tbody>
          </table>
        </div>
      </div>

      ${secondaryPicksHtml}

      <div class="article-prose">
        ${sanitizeRichHtml(review.prose)}
      </div>

      <div class="ad-slot-container">
        <div class="ad-slot-container__label">ADVERTISEMENT // GOOGLE ADSENSE & MEDIAVINE DISPLAY SLOT (ZERO-CLS RESERVED)</div>
        <div style="font-family:var(--font-mono);font-size:0.78rem;color:var(--text-secondary);">728x90 / Responsive Hardware Lab Unit — High-RPM US Consumer Electronics Contextual Placement</div>
      </div>
    `;
    neutralizeLinks(mount);
  }

  // 6. Head metadata for the two dynamic templates + aria-current on nav
  const SITE_ORIGIN = "https://homeworldpress.com";
  const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/images/og-homeworldpress.png`;

  /* og:image e JSON-LD exigem URL absoluta; o catálogo guarda caminho
     relativo ("images/covers/x.svg") e o crawler descarta o relativo. */
  const absoluteUrl = (u) => (u ? (/^https?:\/\//i.test(u) ? u : `${SITE_ORIGIN}/${String(u).replace(/^\/+/, "")}`) : DEFAULT_OG_IMAGE);

  /* Facebook, X e LinkedIn não renderizam SVG em og:image: o card sai vazio.
     O JSON-LD aceita SVG, então só o compartilhamento cai no PNG genérico. */
  const socialImage = (u) => (/\.svg$/i.test(String(u || "")) ? DEFAULT_OG_IMAGE : absoluteUrl(u));
  const MONTH_NUMBERS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

  // Schema dates must be real calendar dates; display strings like "UPDATED OCTOBER 2026" are not.
  function isoDate(input) {
    const m = String(input || "").match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})/);
    if (!m) return null;
    const month = MONTH_NUMBERS[m[1].slice(0, 3)];
    if (!month) return null;
    return `${m[3]}-${String(month).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
  }

  function setMeta(selector, attrs, content) {
    let tag = document.head.querySelector(selector);
    if (!tag) {
      tag = document.createElement("meta");
      Object.entries(attrs).forEach(([k, v]) => tag.setAttribute(k, v));
      document.head.appendChild(tag);
    }
    tag.setAttribute("content", content);
  }

  function setNoindex() {
    let tag = document.head.querySelector('meta[name="robots"]');
    if (!tag) {
      tag = document.createElement("meta");
      tag.setAttribute("name", "robots");
      document.head.appendChild(tag);
    }
    tag.setAttribute("content", "noindex");
  }

  function setLink(rel, href) {
    let tag = document.head.querySelector(`link[rel="${rel}"]`);
    if (!tag) {
      tag = document.createElement("link");
      tag.setAttribute("rel", rel);
      document.head.appendChild(tag);
    }
    tag.setAttribute("href", href);
  }

  function writeJsonLd(obj) {
    let tag = document.head.querySelector('script[type="application/ld+json"]');
    if (!tag) {
      tag = document.createElement("script");
      tag.setAttribute("type", "application/ld+json");
      document.head.appendChild(tag);
    }
    tag.textContent = JSON.stringify(obj);
  }

  function applyHeadTags({ title, description, url, image, type }) {
    document.title = title;
    setMeta('meta[name="description"]', { name: "description" }, description);
    setLink("canonical", url);
    setMeta('meta[property="og:title"]', { property: "og:title" }, title);
    setMeta('meta[property="og:description"]', { property: "og:description" }, description);
    setMeta('meta[property="og:url"]', { property: "og:url" }, url);
    setMeta('meta[property="og:image"]', { property: "og:image" }, image);
    setMeta('meta[property="og:type"]', { property: "og:type" }, type);
    setMeta('meta[property="og:site_name"]', { property: "og:site_name" }, "Homeworld Press");
    setMeta('meta[property="og:locale"]', { property: "og:locale" }, "en_US");
    setMeta('meta[name="twitter:card"]', { name: "twitter:card" }, "summary_large_image");
    setMeta('meta[name="twitter:title"]', { name: "twitter:title" }, title);
    setMeta('meta[name="twitter:description"]', { name: "twitter:description" }, description);
    setMeta('meta[name="twitter:image"]', { name: "twitter:image" }, image);
  }

  function initDynamicHead() {
    const isArticle = !!document.getElementById("dynamicArticleMount");
    const isReview = !!document.getElementById("dynamicReviewMount");
    if ((!isArticle && !isReview) || !DB) return;

    const params = new URLSearchParams(window.location.search);
    const mount = document.getElementById("dynamicArticleMount") || document.getElementById("dynamicReviewMount");
    const id = params.get("id") || (mount && mount.dataset.id) || null;
    const page = isArticle ? "article.html" : "review.html";
    const selfUrl = `${SITE_ORIGIN}/${page}`;

    if (isArticle) {
      const article = DB.articles.find((a) => a.id === id) || (id ? null : DB.articles[0]);
      if (!article) {
        /* URL quebrada: sem canonical para a página "sem nada" e fora do índice. */
        setNoindex();
        setLink("canonical", selfUrl);
        setMeta('meta[property="og:url"]', { property: "og:url" }, selfUrl);
        return;
      }
      const url = `${SITE_ORIGIN}/${page}?id=${encodeURIComponent(article.id)}`;
      applyHeadTags({
        title: `${article.title} | Homeworld Press`,
        description: article.dek,
        url,
        image: socialImage(article.image),
        type: "article",
      });
      writeJsonLd({
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        headline: article.title,
        description: article.dek,
        image: absoluteUrl(article.image),
        ...(isoDate(article.date) ? { datePublished: isoDate(article.date) } : {}),
        articleSection: article.kicker,
        author: { "@type": "Person", name: article.author },
        publisher: {
          "@type": "Organization",
          name: "Homeworld Press",
          url: SITE_ORIGIN,
          logo: { "@type": "ImageObject", url: DEFAULT_OG_IMAGE },
        },
        mainEntityOfPage: { "@type": "WebPage", "@id": url },
      });
      return;
    }

    const review = DB.reviews.find((r) => r.id === id) || (id ? null : DB.reviews[0]);
    if (!review) {
      setNoindex();
      setLink("canonical", selfUrl);
      setMeta('meta[property="og:url"]', { property: "og:url" }, selfUrl);
      return;
    }
    const url = `${SITE_ORIGIN}/${page}?id=${encodeURIComponent(review.id)}`;
    applyHeadTags({
      title: `${review.title} | Homeworld Press Hardware Lab`,
      description: review.summary,
      url,
      image: socialImage(review.image),
      type: "article",
    });
    /* Product+Review, não Article: é o que dá estrela e faixa de preço no
       Google. O shell HTML traz um Product de exemplo; sem reescrever, ele
       ficaria descrevendo o produto errado em toda resenha. */
    const rating = String(review.score || "").split("/")[0].trim();
    writeJsonLd({
      "@context": "https://schema.org",
      "@type": "Product",
      name: review.topPickName || review.title,
      description: review.summary,
      image: absoluteUrl(review.image),
      review: {
        "@type": "Review",
        name: review.title,
        reviewBody: review.summary,
        ...(rating ? { reviewRating: { "@type": "Rating", ratingValue: rating, bestRating: "10", worstRating: "0" } } : {}),
        ...(isoDate(review.updated) ? { datePublished: isoDate(review.updated) } : {}),
        author: { "@type": "Organization", name: "Homeworld Press Editorial Lab" },
        publisher: { "@type": "Organization", name: "Homeworld Press", url: SITE_ORIGIN },
      },
    });
  }

  function initAriaCurrent() {
    const path = window.location.pathname.replace(/index\.html$/, "/");
    document.querySelectorAll(".wired-nav__link").forEach((link) => {
      const href = new URL(link.href, window.location.href).pathname.replace(/index\.html$/, "/");
      if (href === path) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  // Vercel Analytics + Suporte a link de exclusão (?admin=true / ?optout=true)
  function initAnalytics() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      // Se acessar com ?admin=true ou ?optout=true, grava no navegador para nunca contar visitas
      if (urlParams.get("admin") === "true" || urlParams.get("optout") === "true") {
        store.set("va-disable", "true");
        // Mostra um aviso discreto confirmando que o aparelho foi excluído
        const banner = document.createElement("div");
        banner.style.cssText = "position:fixed;bottom:15px;right:15px;background:#E50914;color:#fff;padding:10px 16px;border-radius:4px;font-family:monospace;font-size:12px;font-weight:bold;z-index:999999;box-shadow:0 4px 12px rgba(0,0,0,0.4);";
        banner.textContent = "✓ Acessos deste aparelho EXCLUÍDOS do Vercel Analytics!";
        document.body.appendChild(banner);
        setTimeout(() => banner.remove(), 4500);
      } else if (urlParams.get("admin") === "false" || urlParams.get("optin") === "true") {
        store.remove("va-disable");
      }

      // Se não estiver desativado para este navegador, carrega o script do Vercel Analytics
      if (store.get("va-disable") !== "true") {
        window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
        const script = document.createElement("script");
        script.defer = true;
        script.src = "/_vercel/insights/script.js";
        document.head.appendChild(script);
      }
    } catch (e) {
      // Ignora silenciosamente se o navegador bloquear localStorage/scripts
    }
  }

  /* Um recurso do navegador bloqueado não pode derrubar o resto da página:
     cada inicializador isola a própria falha. */
  const safe = (fn) => {
    try { fn(); } catch (err) { console.error("init falhou:", err); }
  };

  document.addEventListener("DOMContentLoaded", () => {
    safe(initTheme);
    safe(initCultureFilter);
    safe(initSearchModal);
    safe(initArticleReader);
    safe(initReviewPage);
    safe(initDynamicHead);
    safe(initAriaCurrent);
    safe(initAnalytics);
  });
})();
