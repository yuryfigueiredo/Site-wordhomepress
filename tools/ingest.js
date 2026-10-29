/* Ingest — curadoria automática de pautas para o HOMEWORLDPRESS.COM.
   Lê feeds públicos gratuitos (sem chave, sem custo), pontua por aderência aos
   5 pilares do site e escreve uma fila em pipeline/leads/AAAA-MM-DD.{json,md}.
   Não publica nada: só decide o que merece ser escrito.

   Uso:
     node tools/ingest.js              # atualiza a fila de hoje
     node tools/ingest.js --limit 40   # corta a fila em 40 pautas
     node tools/ingest.js --show       # só imprime a fila já gravada        */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LEAD_DIR = path.join(ROOT, "pipeline", "leads");
const STATE_FILE = path.join(ROOT, "pipeline", "state", "seen.json");
const ARGS = process.argv.slice(2);
const LIMIT = Number((ARGS.find((a) => a.startsWith("--limit=")) || "").split("=")[1] || (ARGS.includes("--limit") ? ARGS[ARGS.indexOf("--limit") + 1] : 0)) || 60;
const PER_SOURCE_CAP = 8;

/* Fontes: todas com RSS/Atom público e gratuito, sem cadastro. */
const FEEDS = [
  { url: "https://www.publishersweekly.com/rss/feature.xml", source: "Publishers Weekly", pillars: ["culture"] },
  { url: "https://reactormag.com/feed/", source: "Reactor", pillars: ["culture"] },
  { url: "https://www.theguardian.com/Books/science-fiction/rss", source: "The Guardian SF", pillars: ["culture"] },
  { url: "https://publishingperspectives.com/feed/", source: "Publishing Perspectives", pillars: ["culture"] },
  { url: "https://www.sfwa.org/feed/", source: "SFWA", pillars: ["culture"] },
  { url: "https://arstechnica.com/feed/", source: "Ars Technica", pillars: ["tech"] },
  { url: "https://www.theverge.com/rss/index.xml", source: "The Verge", pillars: ["tech"] },
  { url: "https://hnrss.org/frontpage", source: "Hacker News", pillars: ["tech"] },
  { url: "https://arstechnica.com/science/feed/", source: "Ars Technica Science", pillars: ["science", "tech"] },
  { url: "https://www.sciencedaily.com/rss/space_time/astronomy.xml", source: "Science Daily Astronomy", pillars: ["science"] },
  { url: "https://phys.org/rss-feed/", source: "Phys.org", pillars: ["science"] },
  { url: "https://www.space.com/feeds/all", source: "Space.com", pillars: ["science"] },
];

/* Vocabulário por pilar — as fronteiras rígidas do PROJECT_BLUEPRINT.md. */
const KEYWORDS = {
  culture: ["novel", "book", "author", "publisher", "publishing", "royalt", "bestseller", "hugo", "nebula", "adaptation", "tv series", "film", "streaming", "comic", "graphic novel", "omnibus", "cover art", "pulp", "sci-fi", "science fiction", "fantasy", "series", "trilogy", "kindle unlimited", "audible", "audiobook", "reading", "editor", "copyright", "translation", "estate", "anniversary", "reissue", "box set"],
  tech: ["e-ink", "e-reader", "kindle", "kobo", "tablet", "display", "battery", "solid-state", "llm", "local ai", "open weights", "gpu", "workstation", "storage", "archival", "optical", "processor", "sensor", "privacy", "model", "hardware", "firmware", "usb", "screen"],
  science: ["nasa", "telescope", "jwst", "webb", "exoplanet", "mars", "europa", "lunar", "moon", "orbit", "probe", "mission", "astro", "physics", "quantum", "atomic clock", "radio", "observatory", "atmosphere", "biosignature", "ocean", "ice", "relativity", "research", "study", "scientists"],
  reviews: ["review", "best ", "top ", "deal", "price", "discount", "vs ", "versus", "comparison", "buying guide", "tested", "hands-on", "upgrade", "accessory", "headphone", "lamp", "chair", "espresso"],
};

const REGISTER_BY_PILLAR = { culture: "analista", tech: "analista", science: "laboratório", reviews: "curador" };

function scoreAgainst(text, pillar) {
  const hits = [];
  for (const kw of KEYWORDS[pillar]) {
    if (text.includes(kw)) hits.push(kw);
  }
  return { score: hits.length, hits };
}

function decodeEntities(s) {
  return String(s)
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+|x[0-9a-f]+);/gi, (_, d) => String.fromCharCode(d[0].toLowerCase() === "x" ? parseInt(d.slice(1), 16) : Number(d)))
    .replace(/&nbsp;/g, " ")
    .replace(/&#8217;|&rsquo;|&apos;|'/g, "'")
    .replace(/&amp;/g, "&");
}

function cleanText(s) {
  return decodeEntities(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s*The post .{0,220}? appeared first on .{0,80}?\.\s*/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFeed(xml) {
  const items = [];
  const chunks = [...xml.matchAll(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/g)].map((m) => m[0]);
  for (const chunk of chunks) {
    const tag = (name) => {
      const m = chunk.match(new RegExp(`<(?:${name}|[^:>]*:${name})[^>]*>([\\s\\S]*?)<\\/(?:${name}|[^:>]*:${name})>`, "i"));
      if (!m) return "";
      return m[1].trim();
    };
    let link = cleanText(tag("link"));
    if (!link) {
      const atom = chunk.match(/<link[^>]*href\s*=\s*["']([^"']+)["']/i);
      link = atom ? cleanText(atom[1]) : "";
    }
    const title = cleanText(tag("title"));
    const description = tag("description") || tag("summary") || tag("content");
    const pubDate = cleanText(tag("pubDate") || tag("updated") || tag("published") || tag("dc:date"));
    if (!title || !/^https?:/i.test(link)) continue;
    items.push({ title, link, description: cleanText(description).slice(0, 400), pubDate });
  }
  return items;
}

function loadSeen() {
  try {
    return new Set(JSON.parse(fs.readFileSync(STATE_FILE, "utf8")).urls || []);
  } catch {
    return new Set();
  }
}
function saveSeen(set) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const keep = [...set].slice(-4000);
  fs.writeFileSync(STATE_FILE, JSON.stringify({ updated: new Date().toISOString(), urls: keep }, null, 2));
}

function titleOverlap(a, b) {
  const words = (s) => new Set(s.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

async function main() {
  if (ARGS.includes("--show")) {
    const file = path.join(LEAD_DIR, `${new Date().toISOString().slice(0, 10)}.md`);
    console.log(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : `nenhuma fila em ${file}`);
    return;
  }

  global.window = {};
  require(path.join(ROOT, "js", "articles-db.js"));
  const DB = global.window.HWP_DATABASE;
  const published = [...DB.articles.map((a) => a.title), ...DB.reviews.map((r) => r.title)];

  const seen = loadSeen();
  const fresh = [];
  let fetched = 0;
  for (const feed of FEEDS) {
    let items = [];
    try {
      const res = await fetch(feed.url, { redirect: "follow", signal: AbortSignal.timeout(20000), headers: { "User-Agent": "Mozilla/5.0 (compatible; HomeworldPressBot/1.0; curadoria local)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      items = parseFeed(await res.text());
      fetched++;
    } catch (err) {
      console.log(`  ! ${feed.source}: ${err.message}`);
      continue;
    }
    for (const item of items) {
      const text = `${item.title} ${item.description}`.toLowerCase();
      const scored = Object.keys(KEYWORDS).map((p) => ({ pillar: p, ...scoreAgainst(text, p) })).sort((a, b) => b.score - a.score);
      const best = scored[0];
      const second = scored[1];
      if (best.score < 2) continue;
      const near = published.some((t) => titleOverlap(item.title, t) > 0.6);
      if (near) continue;
      const pillar = best.pillar === "reviews" && second.score >= best.score - 1 ? second.pillar : best.pillar;
      fresh.push({
        url: item.link,
        title: item.title.trim(),
        source: feed.source,
        feed_pillars: feed.pillars,
        pillar,
        register: REGISTER_BY_PILLAR[pillar] || "analista",
        score: best.score,
        keywords: best.hits.slice(0, 8),
        fit: feed.pillars.includes(pillar) ? "direto" : "secundário",
        summary: item.description.slice(0, 240),
        published: item.pubDate,
      });
    }
  }

  const byUrl = new Map();
  const accepted = [];
  for (const lead of fresh) {
    if (seen.has(lead.url) || byUrl.has(lead.url)) continue;
    if (accepted.some((l) => titleOverlap(l.title, lead.title) > 0.72)) continue;
    byUrl.set(lead.url, lead);
    accepted.push(lead);
  }
  const perSource = {};
  const queue = [];
  for (const lead of accepted.sort((a, b) => (b.fit === "direto") - (a.fit === "direto") || b.score - a.score)) {
    perSource[lead.source] = (perSource[lead.source] || 0) + 1;
    if (perSource[lead.source] > PER_SOURCE_CAP) continue;
    queue.push(lead);
    if (queue.length >= LIMIT) break;
  }
  const today = new Date().toISOString().slice(0, 10);

  fs.mkdirSync(LEAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(LEAD_DIR, `${today}.json`), JSON.stringify({ generated: new Date().toISOString(), feeds_ok: fetched, count: queue.length, leads: queue }, null, 2));
  fs.writeFileSync(
    path.join(LEAD_DIR, `${today}.md`),
    [
      `# Fila de pautas — ${today}`,
      "",
      `${queue.length} pautas de ${fetched}/${FEEDS.length} feeds. Gerado por \`tools/ingest.js\`; nada aqui foi publicado.`,
      "Score = nº de termos do pilar encontrados. `fit: direto` = a fonte bate com o pilar sugerido.",
      "",
      ...queue.map((l, i) =>
        [
          `## ${String(i + 1).padStart(2, "0")} · [${l.pillar.toUpperCase()}] ${l.title}`,
          `- fonte: ${l.source} · score ${l.score} · fit ${l.fit} · registro sugerido: ${l.register}`,
          `- ${l.summary}`,
          `- url: ${l.url}`,
          `- termos: ${l.keywords.join(", ")}`,
        ].join("\n"),
      ),
    ].join("\n"),
  );
  for (const lead of queue) seen.add(lead.url);
  saveSeen(seen);

  console.log(`fila: ${queue.length} pautas (${fetched}/${FEEDS.length} feeds ok) → pipeline/leads/${today}.md`);
  const perPillar = {};
  for (const l of queue) perPillar[l.pillar] = (perPillar[l.pillar] || 0) + 1;
  console.log("distribuição:", JSON.stringify(perPillar));
}

main().catch((err) => {
  console.error("ingest falhou:", err);
  process.exit(1);
});
