/* Ingest — curadoria automática de pautas para o HOMEWORLDPRESS.COM.
   Lê feeds públicos gratuitos (sem chave, sem custo), pontua por aderência aos
   5 pilares do site e escreve uma fila em pipeline/leads/AAAA-MM-DD.{json,md}.
   Não publica nada: só decide o que merece ser escrito.

   Uso:
     node tools/ingest.js              # acumula a fila de hoje (não reescreve a rodada anterior)
     node tools/ingest.js --limit 40   # corta a fila acumulada em 40 pautas
     node tools/ingest.js --show       # só imprime a fila já gravada        */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const mem = require("./lib/memory");
/* As três bocas abaixo são a boca de teste (.audit/teste-fila-acumulada.js), a
   mesma convenção do HWP_REPO/HWP_STATE do ~/.local/bin/hwp-turno.sh: sem elas
   a fila acumulada só poderia ser provada contra o repo real, gravando no
   pipeline/leads/ e no seen.json desta máquina. Sem variável, os caminhos são
   exatamente os de sempre. */
const LEAD_DIR = process.env.HWP_LEAD_DIR ? path.resolve(process.env.HWP_LEAD_DIR) : path.join(ROOT, "pipeline", "leads");
const STATE_FILE = process.env.HWP_SEEN_FILE ? path.resolve(process.env.HWP_SEEN_FILE) : path.join(ROOT, "pipeline", "state", "seen.json");
const ARGS = process.argv.slice(2);
const LIMIT = Number((ARGS.find((a) => a.startsWith("--limit=")) || "").split("=")[1] || (ARGS.includes("--limit") ? ARGS[ARGS.indexOf("--limit") + 1] : 0)) || 60;
const PER_SOURCE_CAP = 8;

/* Fontes: todas com RSS/Atom público e gratuito, sem cadastro. A boca
   HWP_FEEDS_JSON existe para a prova não depender de rede — quem entra por ela
   percorre o MESMO parseFeed, pontuação e fusão acima; é lista trocada, não
   implementação paralela. */
const FEEDS = (() => {
  if (!process.env.HWP_FEEDS_JSON)
    return [
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
  try {
    const j = JSON.parse(process.env.HWP_FEEDS_JSON);
    if (!Array.isArray(j) || !j.length) throw new Error("não é uma lista");
    return j.map((f, i) => ({ url: String(f.url), source: String(f.source || `feed-${i}`), pillars: Array.isArray(f.pillars) && f.pillars.length ? f.pillars : ["culture"] }));
  } catch (err) {
    console.error(`HWP_FEEDS_JSON ilegível (${err.message}) — a rodada parou antes de coletar: cair no padrão silencioso faria a prova conferir os feeds reais achando que conferia os da fixture.`);
    process.exit(1);
  }
})();

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

/* O visto é memória de coleta, não lista negra: `pick-lead.js` só lê as três
   filas mais recentes, então um card que sai dessa janela sem publicar está
   morto — o feed continua oferecendo, o `seen` não deixa reentrar. Medido na
   virada para 15/11: 133 itens novatos nos feeds, ZERO pautas aceitas; com o
   mesmo `seen` podado para as filas vivas a coleta devolve 35 e ainda corta 51
   por teto de fonte. A podadeira devolve a cauda; a duplicata continua barrada
   em dois lugares que não envelhecem — `fontesPublicadas` (URL do que está no
   ar) e a memória de tentativas do `pick-lead`. */
function urlsNasFilasVivas(janela = 3) {
  const set = new Set();
  let files = [];
  try {
    files = fs.readdirSync(LEAD_DIR).filter((f) => f.endsWith(".json")).sort().reverse();
  } catch {
    return set;
  }
  for (const f of files.slice(0, janela)) {
    try {
      for (const l of JSON.parse(fs.readFileSync(path.join(LEAD_DIR, f), "utf8")).leads || []) if (l && l.url) set.add(l.url);
    } catch {}
  }
  return set;
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

/* A fila do dia é acumulativa porque o visto-foi-coletado não volta atrás.
   seen.json marca toda URL que entrou na fila (é o que impede a recoleta), e
   até 14/11 cada rodada escrevia o arquivo do dia por cima: o item vivia o
   tempo de uma rodada e morria com a escrita seguinte, deixando no disco um
   arquivo de 1 pauta em dia de 4 rodadas (11-13 e 11-14) contra 19 num dia em
   que a última ingestão foi a primeira (11-11). O pick-lead lê as 3 filas mais
   recentes, então a cola onde a memória sobrevivia — o arquivo — era justamente
   a peça jogada fora. */
function leFilaAnterior(arquivo) {
  try {
    const j = JSON.parse(fs.readFileSync(arquivo, "utf8"));
    return { leads: Array.isArray(j.leads) ? j.leads : [], geracoes: Number(j.rodadas) || 0, primeira: j.primeira_coleta || j.generated || null };
  } catch {
    return { leads: [], geracoes: 0, primeira: null };
  }
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
  const fontesNoAr = mem.fontesPublicadas(DB);

  const seen = loadSeen();
  /* A poda vem antes de qualquer filtro: o que não está mais em fila alcançável
     pelo pick-lead deixa de estar "visto" e volta a disputar a coleta. */
  const vivas = urlsNasFilasVivas();
  let vistasForaDaJanela = 0;
  for (const u of [...seen]) if (!vivas.has(u)) { seen.delete(u); vistasForaDaJanela++; }
  const fresh = [];
  let fetched = 0;
  let jaPublicadas = 0;
  for (const feed of FEEDS) {
    let items = [];
    try {
      const res = await fetch(feed.url, { redirect: "follow", signal: AbortSignal.timeout(20000), headers: { "User-Agent": "Mozilla/5.0 (compatible; HomeworldPressBot/1.0; curadoria local)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      items = parseFeed(await res.text());
      fetched++;
    } catch (err) {
      /* "fetch failed" sozinho não diz se foi DNS, TLS, timeout ou bloqueio de
         bot — e foi exatamente essa linha muda que fez 2/12 feeds sumirem da
         rodada sem diagnóstico possível. */
      const causa = err.cause ? ` (${err.cause.code || err.cause.message || err.cause})` : "";
      console.log(`  ! ${feed.source}: ${err.message}${causa}`);
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
      /* Título reescrito pelo modelo engana a comparação de cima: em 2026-10-31
         a mesma notícia da ScienceDaily entrou duas vezes porque "NASA's Webb
         finds signs of Mars-sized worlds" não se parece com "Webb Detects Dust
         Halos...". A URL da fonte é a memória que não falha. */
      if (fontesNoAr.has(mem.urlChave(item.link))) {
        jaPublicadas++;
        continue;
      }
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

  /* A fusão começa pelo que o arquivo de hoje já tinha e só depois deixa a
     rodada atual falar: um item velho repetido com URL nova tem de ser barrado
     pela sobreposição de título contra o card que está no disco, não apenas
     contra os novos. O `seen` continua marcando toda URL da fila — é ele que
     impede a recoleta; o que muda é que nada é esquecido junto. */
  const today = new Date().toISOString().slice(0, 10);
  const arquivoJson = path.join(LEAD_DIR, `${today}.json`);
  const anterior = leFilaAnterior(arquivoJson);
  const agora = new Date().toISOString();
  /* A fusão é assimétrica de propósito, e a assimetria é a régua: o que já
     estava no arquivo NUNCA sai, e quem é cortado é o novato. Capar a lista
     merged (como fazia a primeira versão) reabre o buraco que o merge fechou
     por outra porta — um card antigo, de score baixo, empurrado para fora por
     uma leva nova de score alto não volta nunca mais: o `seen.json` já o
     marcou na coleta que o trouxe, e a URL não é reofertada. O novato cortado
     volta na rodada seguinte porque só entra no `seen` o que chegou ao arquivo.
     Por isso o teto por fonte conta o que já está dentro, e o LIMIT é vagas
     restantes, não uma fatia da lista inteira. */
  const mantidas = [];
  const urlsNaFila = new Set();
  const porFonte = {};
  const enfileira = (lead) => {
    const chave = mem.urlChave(lead.url);
    if (!chave || !lead.title) return false;
    if (urlsNaFila.has(chave)) return false;
    if (mantidas.some((l) => titleOverlap(l.title, lead.title) > 0.72)) return false;
    urlsNaFila.add(chave);
    porFonte[lead.source] = (porFonte[lead.source] || 0) + 1;
    mantidas.push(lead);
    return true;
  };
  for (const lead of anterior.leads) enfileira(lead);
  let descartadasNaFusao = anterior.leads.length - mantidas.length;
  let cortadasPorCap = 0;
  let vagas = Math.max(0, LIMIT - mantidas.length);
  for (const lead of [...accepted].sort((a, b) => (b.fit === "direto") - (a.fit === "direto") || b.score - a.score)) {
    const chave = mem.urlChave(lead.url);
    if (!chave || urlsNaFila.has(chave) || mantidas.some((l) => l.title && lead.title && titleOverlap(l.title, lead.title) > 0.72)) {
      descartadasNaFusao++;
      continue;
    }
    if (porFonte[lead.source] >= PER_SOURCE_CAP || vagas <= 0) {
      cortadasPorCap++;
      continue;
    }
    vagas--;
    enfileira(lead);
  }
  const queue = mantidas.sort((a, b) => (b.fit === "direto") - (a.fit === "direto") || b.score - a.score);

  fs.mkdirSync(LEAD_DIR, { recursive: true });
  /* feeds_ok é desta coleta, não da fila: um arquivo pode carregar pautas de
     uma rodada em que os 12 feeds abriram junto de pautas de uma em que só 5
     responderam. Quem lê precisa saber o estado do cabo AGORA, senão um 12/12
     mentiria sobre a última tentativa. primeira_coleta separa fila magra de
     coleta recém-aberta: era isso que fazia 1 pauta parecer "o dia inteiro".

     O card que já estava no arquivo entra na escrita com os campos dele e sem
     `keywords`; a linha de termos acima leria undefined, e este repo tem
     histórico de portão verde lendo texto de exceção (ver a trava de arquivo). */
  const porUrl = new Map(queue.map((l) => [mem.urlChave(l.url), l]));
  const cards = queue.map((l) => ({ ...porUrl.get(mem.urlChave(l.url)), keywords: l.keywords || [] }));
  fs.writeFileSync(
    arquivoJson,
    JSON.stringify(
      {
        generated: agora,
        primeira_coleta: anterior.primeira || agora,
        rodadas: anterior.geracoes + 1,
        feeds_ok: fetched,
        count: cards.length,
        leads: cards,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(LEAD_DIR, `${today}.md`),
    [
      `# Fila de pautas — ${today}`,
      "",
      `${cards.length} pautas acumuladas em ${anterior.geracoes + 1} rodada(s) de coleta; nesta, ${fetched}/${FEEDS.length} feeds responderam. Gerado por \`tools/ingest.js\`; nada aqui foi publicado.`,
      "Score = nº de termos do pilar encontrados. `fit: direto` = a fonte bate com o pilar sugerido.",
      "",
      ...cards.map((l, i) =>
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

  console.log(`fila: ${queue.length} pautas acumuladas em ${anterior.geracoes + 1} rodada(s) (${fetched}/${FEEDS.length} feeds ok nesta) → pipeline/leads/${today}.md${descartadasNaFusao ? ` · ${descartadasNaFusao} repetida(s) na fusão` : ""}${vistasForaDaJanela ? ` · ${vistasForaDaJanela} vista(s) fora da janela de 3 filas voltaram a ser coletáveis` : ""}${cortadasPorCap ? ` · ${cortadasPorCap} novata(s) cortada(s) por fonte/teto, voltam na próxima rodada` : ""}`);
  const perPillar = {};
  for (const l of queue) perPillar[l.pillar] = (perPillar[l.pillar] || 0) + 1;
  console.log("distribuição:", JSON.stringify(perPillar), jaPublicadas ? `· ${jaPublicadas} pautas já estavam no ar (fonte repetida)` : "");
}

main().catch((err) => {
  console.error("ingest falhou:", err);
  process.exit(1);
});
