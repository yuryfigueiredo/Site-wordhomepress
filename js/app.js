/* ==========================================================================
   HOMEWORLD PRESS — INTERACTIVE EDITORIAL ENGINE (js/app.js v2)
   ========================================================================== */

(function () {
  "use strict";

  const DB = window.HWP_DATABASE;

  /* Títulos de fonte vêm de feed de terceiro: entram como texto, nunca como HTML. */
  const escapeHtml = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  // 1. Theme Persistence (Editorial Paper vs. WIRED Dark Mode)
  function initTheme() {
    const saved = localStorage.getItem("hwp_theme") || "light";
    document.documentElement.setAttribute("data-theme", saved);
    updateThemeButtons(saved);

    document.querySelectorAll("[data-action='toggle-theme']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const current = document.documentElement.getAttribute("data-theme") || "light";
        const next = current === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("hwp_theme", next);
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
        <a href="${m.url}" class="search-result-link">
          <div class="kicker" style="font-size:0.65rem;">${m.kicker}</div>
          <div style="font-family:var(--font-display);font-weight:800;font-size:1rem;margin-top:0.2rem;">${m.title}</div>
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
    const id = params.get("id");
    const article = DB.articles.find((a) => a.id === id) || DB.articles[0];

    document.title = `${article.title} | Homeworld Press`;
    const desc = document.querySelector('meta[name="description"]');
    if (desc && article.dek) desc.setAttribute("content", article.dek);

    /* O breadcrumb é estático no HTML; sem isto toda matéria de ciência
       aparecia como "Culture / Buyer's Guides". */
    const SUBTOPIC_LABEL = { authors: "Authors", news: "News", comics: "Comics", guides: "Guides", concepts: "Concepts", space: "Space" };
    const crumbCat = document.getElementById("crumbCategory");
    if (crumbCat) {
      crumbCat.textContent = article.category.charAt(0).toUpperCase() + article.category.slice(1);
      crumbCat.setAttribute("href", `${article.category}.html`);
    }
    const crumbSub = document.getElementById("crumbSubtopic");
    if (crumbSub) {
      crumbSub.textContent = SUBTOPIC_LABEL[article.subtopic] || "Articles";
      crumbSub.setAttribute("href", `${article.category}.html`);
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
      const prosHtml = (box.pros || []).map((p) => `<li>✓ ${p}</li>`).join("");
      const consHtml = (box.cons || []).map((c) => `<li>✕ ${c}</li>`).join("");
      const verdictImg = article.bookCover || article.image;
      const verdictImgFit = article.bookCover ? "contain" : "cover";
      const isExternalSecondary = /^https?:\/\//i.test(box.audibleUrl || "");
      verdictHtml = `
      <!-- High-Converting WIRED + Wirecutter Affiliate Verdict Box -->
      <div class="verdict-box">
        <div class="verdict-box__ribbon">
          <span>★ ${box.badge}</span>
          <span>SCORE: ${box.score}</span>
        </div>
        <div class="verdict-box__inner">
          <img src="${verdictImg}" alt="${box.title}" style="width:100%;height:165px;object-fit:${verdictImgFit};background:#0d0d0d;border:var(--border-hairline);">
          <div>
            <h3 style="font-family:var(--font-display);font-size:1.3rem;font-weight:900;margin-bottom:0.35rem;">${box.title}</h3>
            <p style="font-family:var(--font-mono);font-size:0.8rem;color:var(--text-muted);margin-bottom:0.85rem;">ESTIMATED PRICE: <strong>${box.price}</strong></p>
            <div style="display:flex;flex-wrap:wrap;gap:0.65rem;">
              <a href="${box.amazonUrl}" target="_blank" rel="nofollow sponsored noopener" class="btn-amazon" style="width:auto;padding:0.65rem 1.25rem;">CHECK PRICE ON AMAZON →</a>
              <a href="${box.audibleUrl}" ${isExternalSecondary ? 'target="_blank" rel="nofollow sponsored noopener"' : ""} class="btn-secondary-dark" style="background:#111;color:#fff;padding:0.65rem 1.1rem;">TRY ON AUDIBLE / MORE →</a>
            </div>
          </div>
        </div>
        <div class="verdict-box__pros-cons" style="padding:0 1.5rem 1.25rem;">
          <div>
            <strong style="font-family:var(--font-mono);font-size:0.74rem;color:#1B7F37;text-transform:uppercase;">WHY WE RECOMMEND IT</strong>
            <ul style="list-style:none;margin-top:0.4rem;display:flex;flex-direction:column;gap:0.3rem;">${prosHtml}</ul>
          </div>
          <div>
            <strong style="font-family:var(--font-mono);font-size:0.74rem;color:#C92A2A;text-transform:uppercase;">KEEP IN MIND</strong>
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
        <span class="kicker kicker--${article.category}">${article.kicker}</span>
        <h1 class="article-title">${article.title}</h1>
        <p class="article-dek">${article.dek}</p>
        <div class="meta-line">
          <span>BY <strong>${article.author}</strong></span>
          <span>•</span>
          <span>${article.date}</span>
          <span>•</span>
          <span>${article.readTime}</span>
        </div>
      </div>

      <figure style="margin-bottom:2rem;border:var(--border-hairline);">
        <img src="${article.image}" alt="${article.title}" fetchpriority="high" width="900" height="500" style="width:100%;max-height:480px;object-fit:cover;">
      </figure>

      ${verdictHtml}

      <div class="article-prose">
        ${article.content}
      </div>

      ${sourcesHtml}

      <div class="ad-slot-container">
        <div class="ad-slot-container__label">ADVERTISEMENT // GOOGLE ADSENSE & MEDIAVINE DISPLAY SLOT (ZERO-CLS RESERVED)</div>
        <div style="font-family:var(--font-mono);font-size:0.78rem;color:var(--text-secondary);">728x90 / Responsive In-Article Unit — High-RPM US Literature & Tech Contextual Placement</div>
      </div>
    `;
  }

  // 5. Buyer's Guide page (review.html?id=...) — dynamically populate full guide, comparison matrix, and tested picks
  function initReviewPage() {
    const mount = document.getElementById("dynamicReviewMount");
    if (!mount || !DB || !Array.isArray(DB.reviews)) return;

    const id = new URLSearchParams(window.location.search).get("id");
    const review = DB.reviews.find((r) => r.id === id) || DB.reviews[0];
    if (!review) return;

    document.title = `${review.title} | Homeworld Press Hardware Lab`;
    const desc = document.querySelector('meta[name="description"]');
    if (desc && review.summary) desc.setAttribute("content", review.summary);

    const prosHtml = (review.pros || []).map((p) => `<li>✓ ${p}</li>`).join("");
    const consHtml = (review.cons || []).map((c) => `<li>✕ ${c}</li>`).join("");

    const matrixRowsHtml = (review.matrixRows || [])
      .map(
        (row) => `
      <tr>
        <th scope="row">${row.model}</th>
        <td>${row.bestFor}</td>
        <td>${row.spec}</td>
        <td><strong>${row.score}</strong></td>
        <td><a href="${row.url}" target="_blank" rel="nofollow sponsored noopener" class="btn-amazon" style="padding:0.4rem 0.7rem;width:auto;">AMAZON →</a></td>
      </tr>
    `
      )
      .join("");

    const secondaryPicksHtml = (review.secondaryPicks || [])
      .map(
        (pick) => `
      <div class="verdict-box">
        <div class="verdict-box__ribbon">
          <span>${pick.ribbon}</span>
          <span>HOMEWORLD SCORE: ${pick.score}</span>
        </div>
        <div class="verdict-box__inner">
          <img src="${pick.image}" alt="${pick.title}" loading="lazy" width="200" height="180" style="width:100%;height:170px;object-fit:cover;border:var(--border-hairline);" />
          <div>
            <h2 style="font-family:var(--font-display);font-size:1.45rem;font-weight:900;margin:0 0 0.35rem;border:none;padding:0;">
              ${pick.title}
            </h2>
            <p style="font-size:0.93rem;color:var(--text-secondary);margin-bottom:0.85rem;">
              ${pick.summary}
            </p>
            <a href="${pick.url}" target="_blank" rel="nofollow sponsored noopener" class="btn-amazon" style="width:auto;padding:0.7rem 1.25rem;">
              ${pick.ctaText}
            </a>
          </div>
        </div>
      </div>
    `
      )
      .join("");

    mount.innerHTML = `
      <div class="article-header">
        <span class="kicker kicker--reviews" id="reviewKicker">${review.kicker}</span>
        <h1 class="article-title" id="reviewTitle">${review.title}</h1>
        <p class="article-dek" id="reviewDek">${review.summary}</p>
        <div class="meta-line">
          <span>BY <strong>HOMEWORLD PRESS LAB TEAM</strong></span>
          <span>•</span>
          <span>${review.updated || "UPDATED OCTOBER 2026"}</span>
          <span>•</span>
          <span>${review.readTime || "10 MIN READ"}</span>
        </div>
      </div>

      <!-- Pick 1: Best Overall -->
      <div class="verdict-box" id="reviewLead">
        <div class="verdict-box__ribbon">
          <span id="reviewLeadAward">🏆 #1 ${review.award} (2026)</span>
          <span id="reviewLeadScore">HOMEWORLD SCORE: ${review.score.replace("/", " / ")}</span>
        </div>
        <div class="verdict-box__inner">
          <img src="${review.image}" id="reviewLeadImg" alt="${review.topPickName}" fetchpriority="high" width="200" height="180" style="width:100%;height:170px;object-fit:cover;border:var(--border-hairline);" />
          <div>
            <h2 id="reviewLeadName" style="font-family:var(--font-display);font-size:1.45rem;font-weight:900;margin:0 0 0.35rem;border:none;padding:0;">
              ${review.topPickName}
            </h2>
            <p id="reviewLeadSummary" style="font-size:0.93rem;color:var(--text-secondary);margin-bottom:0.85rem;">
              <strong>Estimated Price Range: ${review.priceRange}.</strong> ${review.summary}
            </p>
            <div style="display:flex;flex-wrap:wrap;gap:0.65rem;">
              <a href="${review.amazonUrl}" target="_blank" rel="nofollow sponsored noopener" id="reviewLeadCta" class="btn-amazon" style="width:auto;padding:0.7rem 1.25rem;">
                CHECK PRICE ON AMAZON US →
              </a>
              <a href="${review.secondaryCtaUrl || "https://www.amazon.com/hz/audible/mlp/membership/plus?tag=homeworldpres-20"}" target="_blank" rel="nofollow sponsored noopener" class="btn-secondary-dark" style="background:#111;color:#fff;width:auto;padding:0.7rem 1.1rem;">
                ${review.secondaryCtaText || "TRY AUDIBLE FREE →"}
              </a>
            </div>
          </div>
        </div>
        <div class="verdict-box__pros-cons" id="reviewLeadProsCons" style="padding:0 1.5rem 1.25rem;">
          <div>
            <strong style="font-family:var(--font-mono);font-size:0.74rem;color:#1B7F37;">PROS</strong>
            <ul style="list-style:none;margin-top:0.35rem;display:flex;flex-direction:column;gap:0.25rem;">${prosHtml}</ul>
          </div>
          <div>
            <strong style="font-family:var(--font-mono);font-size:0.74rem;color:#C92A2A;">CONS</strong>
            <ul style="list-style:none;margin-top:0.35rem;display:flex;flex-direction:column;gap:0.25rem;">${consHtml}</ul>
          </div>
        </div>
      </div>

      <!-- Side-by-Side Comparison Matrix -->
      <div class="article-prose">
        <h2>${review.matrixTitle}</h2>
        <div tabindex="0" role="region" aria-labelledby="ereader-matrix-caption" class="table-wrapper" style="margin-block:1.5rem;">
          <table class="comparison-table">
            <caption id="ereader-matrix-caption">
              ${review.matrixCaption}
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
        ${review.prose || ""}
      </div>

      <div class="ad-slot-container">
        <div class="ad-slot-container__label">ADVERTISEMENT // GOOGLE ADSENSE & MEDIAVINE DISPLAY SLOT (ZERO-CLS RESERVED)</div>
        <div style="font-family:var(--font-mono);font-size:0.78rem;color:var(--text-secondary);">728x90 / Responsive Hardware Lab Unit — High-RPM US Consumer Electronics Contextual Placement</div>
      </div>
    `;
  }

  // 6. Head metadata for the two dynamic templates + aria-current on nav
  const SITE_ORIGIN = "https://homeworldpress.com";
  const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/images/og-homeworldpress.png`;
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
    const page = isArticle ? "article.html" : "review.html";
    const selfUrl = `${SITE_ORIGIN}/${page}`;

    if (isArticle) {
      const article = DB.articles.find((a) => a.id === params.get("id"));
      if (!article) {
        setLink("canonical", selfUrl);
        setMeta('meta[property="og:url"]', { property: "og:url" }, selfUrl);
        return;
      }
      const url = `${SITE_ORIGIN}/${page}?id=${encodeURIComponent(article.id)}`;
      applyHeadTags({
        title: `${article.title} | Homeworld Press`,
        description: article.dek,
        url,
        image: article.image || DEFAULT_OG_IMAGE,
        type: "article",
      });
      writeJsonLd({
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        headline: article.title,
        description: article.dek,
        image: article.image || DEFAULT_OG_IMAGE,
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

    const review = DB.reviews.find((r) => r.id === params.get("id"));
    if (!review) {
      setLink("canonical", selfUrl);
      setMeta('meta[property="og:url"]', { property: "og:url" }, selfUrl);
      return;
    }
    const url = `${SITE_ORIGIN}/${page}?id=${encodeURIComponent(review.id)}`;
    applyHeadTags({
      title: `${review.title} | Homeworld Press Hardware Lab`,
      description: review.summary,
      url,
      image: review.image || DEFAULT_OG_IMAGE,
      type: "article",
    });
    writeJsonLd({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: review.title,
      description: review.summary,
      image: review.image || DEFAULT_OG_IMAGE,
      ...(isoDate(review.updated) ? { dateModified: isoDate(review.updated) } : {}),
      author: { "@type": "Organization", name: "Homeworld Press Lab" },
      publisher: { "@type": "Organization", name: "Homeworld Press", url: SITE_ORIGIN },
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
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
        localStorage.setItem("va-disable", "true");
        // Mostra um aviso discreto confirmando que o aparelho foi excluído
        const banner = document.createElement("div");
        banner.style.cssText = "position:fixed;bottom:15px;right:15px;background:#E50914;color:#fff;padding:10px 16px;border-radius:4px;font-family:monospace;font-size:12px;font-weight:bold;z-index:999999;box-shadow:0 4px 12px rgba(0,0,0,0.4);";
        banner.textContent = "✓ Acessos deste aparelho EXCLUÍDOS do Vercel Analytics!";
        document.body.appendChild(banner);
        setTimeout(() => banner.remove(), 4500);
      } else if (urlParams.get("admin") === "false" || urlParams.get("optin") === "true") {
        localStorage.removeItem("va-disable");
      }

      // Se não estiver desativado para este navegador, carrega o script do Vercel Analytics
      if (localStorage.getItem("va-disable") !== "true") {
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

  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initCultureFilter();
    initSearchModal();
    initArticleReader();
    initReviewPage();
    initDynamicHead();
    initAriaCurrent();
    initAnalytics();
  });
})();
