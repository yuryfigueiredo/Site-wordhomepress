/* Doctor — varredura de manutenção do HOMEWORLDPRESS.COM.
   Uso:
     node tools/doctor.js              # tudo, incluindo links externos
     node tools/doctor.js --offline    # pula a checagem de rede
     node tools/doctor.js --quick      # só catálogo + assets + metadata
   Saída: console + tools/reports/AAAA-MM-DD.md.  Exit 1 quando há ERROR. */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const ARGS = process.argv.slice(2);
const OFFLINE = ARGS.includes("--offline");
const QUICK = ARGS.includes("--quick");
const ORIGIN = "https://www.homeworldpress.com";
const PLACEHOLDER_TAG = "homeworldpres-20";

global.window = {};
require(path.join(ROOT, "js", "articles-db.js"));
const DB = global.window.HWP_DATABASE;
/* Mesma injeção de notas do build.js: sem ela, `a.rank` não existe aqui e a
   régua da capa enxerga um catálogo sem nota. */
require("./lib/catalog-notes").aplicar(DB, ROOT);

const errors = [];
const warnings = [];
const infos = [];
const fail = (check, msg) => errors.push({ check, msg });
const warn = (check, msg) => warnings.push({ check, msg });
const note = (check, msg) => infos.push({ check, msg });

const HTML_FILES = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    /* pipeline/ guarda fragmentos (a capa de fallback), não páginas: checar
       lang/favicon/<main> neles seria alarme falso.
       dist/ é cópia gerada por tools/build-dist.js: auditar fonte e cópia
       juntos duplica cada achado. */
    if (entry.isDirectory() && (entry.name === "pipeline" || entry.name === "dist")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.x?html?$/i.test(entry.name)) HTML_FILES.push(path.relative(ROOT, full).replace(/\\/g, "/"));
  }
})(ROOT);

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel.replace(/^\/+/, "")));

/* ── 1. Assets locais: existem e são de facto imagens ─────────────────── */
const MAGIC = {
  jpg: [[0xff, 0xd8, 0xff]],
  png: [[0x89, 0x50, 0x4e, 0x47]],
  gif: [[0x47, 0x49, 0x46, 0x38]],
  webp: [[0x52, 0x49, 0x46, 0x46]],
  ico: [[0x00, 0x00, 0x01, 0x00]],
};
function isRealImage(rel) {
  const abs = path.join(ROOT, rel.replace(/^\/+/, ""));
  const head = Buffer.alloc(16);
  const fd = fs.openSync(abs, "r");
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  const ext = path.extname(abs).toLowerCase().replace(".", "");
  if (ext === "svg") return /<svg/i.test(head.toString("latin1") + read(rel).slice(0, 400));
  const sigs = MAGIC[ext];
  if (!sigs) return false;
  return sigs.some((sig) => sig.every((b, i) => head[i] === b));
}

const LOCAL_REF = /(?:src|href|poster)\s*=\s*["']([^"']+)["']|["']((?:\.?\/)?(?:images|css|js)\/[^"']+)["']/g;
const localRefs = new Map();
for (const file of [...HTML_FILES, "js/articles-db.js"]) {
  const base = file === "js/articles-db.js" ? "" : path.dirname(file);
  /* src="" ou href="" renderizam como recurso quebrado: é erro, não aviso. */
  for (const m of read(file).matchAll(/\b(?:src|href)\s*=\s*["']\s*["']/gi)) {
    fail("asset-empty", `${file}: atributo vazio (src/href sem valor) — card ou link quebrado para o leitor`);
  }
  for (const m of read(file).matchAll(LOCAL_REF)) {
    const raw = (m[1] || m[2] || "").trim();
    if (!raw || /^(https?:|mailto:|tel:|data:|javascript:|#)/i.test(raw)) continue;
    const bare = raw.split("?")[0].split("#")[0];
    if (!bare) continue;
    /* Caminho root-relative (ex.: /feed.xml) resolve da raiz do site. */
    const rel = bare.startsWith("/")
      ? bare.replace(/^\/+/, "").replace(/\\/g, "/")
      : path.normalize(path.join(base, bare)).replace(/\\/g, "/");
    if (!localRefs.has(rel)) localRefs.set(rel, new Set());
    localRefs.get(rel).add(file);
  }
}
for (const [rel, files] of [...localRefs].sort()) {
  if (!exists(rel)) {
    fail("asset-missing", `${rel} referenciado em ${[...files].join(", ")} não existe no disco`);
    continue;
  }
  if (/\.(jpe?g|png|webp|gif|ico|svg)$/i.test(rel) && !isRealImage(rel)) {
    fail("asset-not-image", `${rel} não é uma imagem real (conteúdo HTML/texto salvo com extensão de imagem)`);
  }
}

/* ── 2. Links internos e âncoras ──────────────────────────────────────── */
for (const file of HTML_FILES) {
  const src = read(file);
  for (const m of src.matchAll(/(?:href|src)\s*=\s*["']([^"'#:]+)(#[^"']*)?["']/g)) {
    const raw = m[1].trim();
    if (/^(https?:|mailto:|tel:|data:|\/\/)/i.test(raw)) continue;
    /* Caminho root-relative (ex.: /feed.xml) resolve da raiz, não do diretório do arquivo. */
    const bare = raw.split("?")[0];
    const target = bare.startsWith("/")
      ? bare.replace(/^\/+/, "")
      : path.join(path.dirname(file), bare);
    const normalized = path.normalize(target);
    if (!fs.existsSync(path.join(ROOT, normalized))) {
      fail("internal-link", `${file} → ${raw} não resolve`);
    }
  }
  for (const m of src.matchAll(/href\s*=\s*"#([^"]+)"/g)) {
    if (!new RegExp(`id\\s*=\\s*["']${m[1]}["']`).test(src)) fail("anchor", `${file} → #${m[1]} sem elemento alvo na página`);
  }
}

/* ── 3. Datas do catálogo ─────────────────────────────────────────────── */
const RELATIVE_DATE = /\b(\d+\s*(?:HOURS?|MINUTES?|DAYS?)\s+AGO|YESTERDAY|JUST NOW|BREAKING)\b/i;
for (const a of DB.articles) {
  if (RELATIVE_DATE.test(a.date)) fail("date-rot", `artigo "${a.id}" com data relativa "${a.date}" — apodrece e quebra o JSON-LD`);
  else if (!/^[A-Za-z]{3}[\w.]*\s+\d{1,2},\s*\d{4}$/.test(a.date) && !/^\d{4}-\d{2}-\d{2}/.test(a.date))
    warn("date-format", `artigo "${a.id}" com data fora do padrão reconhecido: "${a.date}"`);
}
for (const r of DB.reviews) {
  if (RELATIVE_DATE.test(r.updated)) fail("date-rot", `review "${r.id}" com data relativa "${r.updated}"`);
}

/* ── 4. Metadata por página ───────────────────────────────────────────── */
const NOINDEX_PAGES = ["404.html", "article.html", "review.html"];
for (const file of HTML_FILES) {
  const src = read(file);
  const stub = /http-equiv\s*=\s*["']refresh["']/i.test(src) || file === "404.html";
  const has = (re) => re.test(src);
  if (!/lang\s*=\s*["']en-US["']/i.test(src)) warn("meta-lang", `${file}: lang não é en-US`);
  if (!/<title>[^<]{10,}<\/title>/i.test(src)) fail("meta-title", `${file}: <title> ausente ou curto demais`);
  if (!stub) {
    if (!has(/name\s*=\s*["']description["']/i)) fail("meta-description", `${file}: sem meta description`);
    if (!has(/property\s*=\s*["']og:image["']/i)) fail("meta-og", `${file}: sem og:image`);
  }
  if (!has(/rel\s*=\s*["']canonical["']/i) && file !== "404.html") fail("meta-canonical", `${file}: sem canonical`);
  if (!has(/rel\s*=\s*["']icon["']/i) && !stub) warn("meta-favicon", `${file}: sem favicon declarado`);
  if (!has(/<main\b/i) && !stub) warn("structure", `${file}: sem <main> (leitor de tela perde o ponto de entrada)`);
  if (!stub && !has(/href\s*=\s*["']#main-content["']/i)) warn("structure", `${file}: sem skip link para #main-content`);
  if (file === "404.html" && !/name\s*=\s*["']robots["'][^>]*noindex/i.test(src))
    fail("meta-robots", "404.html sem noindex — o Google indexa a página de erro");
  if (/\b\d+\s*(?:H|HR|HOURS?|MIN|MINUTES?)\s*AGO\b/i.test(src))
    warn("date-rot", `${file}: data relativa visível na página ("2H AGO" e afins apodrecem em horas)`);
  if (stub && !/name\s*=\s*["']robots["'][^>]*noindex/i.test(src)) warn("meta-robots", `${file}: página de redirect sem noindex`);
  for (const m of src.matchAll(/<input\b[^>]*>/gi)) {
    if (!/aria-label|id\s*=|type\s*=\s*["']hidden["']/i.test(m[0])) fail("a11y-input", `${file}: <input> sem label/aria-label → ${m[0].slice(0, 90)}`);
  }
}

/* ── 5. Sitemap desatualizado ─────────────────────────────────────────── */
if (fs.existsSync(path.join(ROOT, "sitemap.xml"))) {
  const idsOnDisk = new Set([...read("sitemap.xml").matchAll(/[?&]id=([^&"'<\s]+)/g)].map((m) => decodeURIComponent(m[1])));
  for (const a of DB.articles) if (!idsOnDisk.has(a.id)) fail("sitemap-drift", `artigo "${a.id}" publicado mas ausente do sitemap.xml`);
  for (const r of DB.reviews) if (!idsOnDisk.has(r.id)) fail("sitemap-drift", `review "${r.id}" publicada mas ausente do sitemap.xml`);
  note("sitemap", `${idsOnDisk.size} URLs dinâmicas no sitemap.xml`);
} else fail("sitemap-drift", "sitemap.xml não existe");

/* ── 5b. feed.xml desatualizado ───────────────────────────────────────── */
/* O RSS é como buscador e agregador ficam sabendo que saiu matéria nova, e
   nada no pipeline regenerava o arquivo: commitado em 06/11, o feed ficou
   parado no Hubble enquanto cinco matérias saíam — verde em todas as rodadas.
   A régua é a MESMA função que escreve o arquivo (build-feed.js → buildItems),
   então publish, doctor e qualquer leitura humana veem a mesma lista. */
if (fs.existsSync(path.join(ROOT, "feed.xml"))) {
  const { buildItems } = require("./build-feed");
  const guidsNoAr = new Set([...read("feed.xml").matchAll(/<guid[^>]*>([^<]+)<\/guid>/g)].map((m) => m[1]));
  const esperado = buildItems();
  const faltando = esperado.filter((it) => !guidsNoAr.has(it.guid));
  const sobrando = [...guidsNoAr].filter((g) => !esperado.some((it) => it.guid === g));
  if (faltando.length)
    fail("feed-stale", `feed.xml sem o(s) item(ns) mais recente(s) do catálogo: ${faltando.map((f) => f.title).join(" | ").slice(0, 200)} — rode node tools/build-feed.js (o publish.js já chama; se você está lendo isto, a etapa saiu do caminho)`);
  if (sobrando.length)
    warn("feed-stale", `feed.xml com ${sobrando.length} item(ns) fora dos 10 mais recentes que buildItems() escolhe: ${sobrando.slice(0, 3).join(", ")}${sobrando.length > 3 ? "…" : ""}`);
  if (!faltando.length && !sobrando.length) note("feed", `${guidsNoAr.size} itens no feed.xml, batendo com buildItems()`);
} else fail("feed-stale", "feed.xml não existe — nada no pipeline avisa agregador sobre matéria nova");

/* ── 6. Aberturas repetidas (memória do catálogo publicado) ───────────── */
function firstSentence(html) {
  const text = String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const m = text.match(/^.{15,}?[.!?](\s|$)/);
  return (m ? m[0] : text.slice(0, 90)).trim().toLowerCase();
}
const openers = new Map();
for (const a of DB.articles) {
  const s = firstSentence(a.content);
  const key = s.split(/\s+/).slice(0, 4).join(" ");
  if (!key) continue;
  if (!openers.has(key)) openers.set(key, []);
  openers.get(key).push(a.id);
}
for (const [key, ids] of openers) if (ids.length > 1) warn("repetition", `abertura igual em ${ids.length} artigos ("${key}…"): ${ids.join(", ")}`);
const shortOpeners = new Set();
for (const a of DB.articles) {
  const s = firstSentence(a.content);
  const shape = s.replace(/[a-z']/g, "x").replace(/\d/g, "9").slice(0, 24);
  if (shortOpeners.has(shape)) warn("repetition", `artigo "${a.id}" abre com o mesmo padrão rítmico de outro: "${s.slice(0, 60)}"`);
  shortOpeners.add(shape);
}

/* ── 7. Conteúdo órfão ────────────────────────────────────────────────── */
/* Alcance é medido por LINK, não por menção. A versão anterior procurava
   `id=<slug>` e `"<slug>"` no texto de todas as páginas juntas: contava a
   própria página da matéria (que é o destino, não a entrada) e aceitava
   qualquer string parecida — o supervisor provou em 09/11 que um
   `<script>window.__LEGADO=["<slug>"]</script>` plantado na home apagava o
   aviso sem criar um clique. Agora: só `article.html?id=` / `review.html?id=`,
   e a própria página não vale. */
const idsLinkadosPorPagina = new Map();
for (const f of HTML_FILES.filter((x) => !NOINDEX_PAGES.includes(x))) {
  const ids = new Set();
  for (const m of String(read(f) || "").matchAll(/(?:article|review)\.html\?id=([^&"'\s<>]+)/g)) ids.add(decodeURIComponent(m[1]));
  idsLinkadosPorPagina.set(f, ids);
}
const alca = (id, propria) => [...idsLinkadosPorPagina].some(([f, ids]) => f !== propria && ids.has(id));
for (const a of DB.articles) {
  if (!alca(a.id, `a-${a.id}.html`)) fail("orphan", `artigo "${a.id}" não é linkado por nenhuma OUTRA página — a própria página é o destino, não a entrada: sem clique para ela, só existe para a busca`);
}
/* Review tem a mesma régua: 09/11 deixou `r-<id>.html` fora do §7 e o `for` só
   olhava DB.articles, então uma review sem entrada passava. O `rec-card` é
   exatamente o markup que apodrece sem ninguém regenerar. */
for (const r of DB.reviews) {
  if (!alca(r.id, `r-${r.id}.html`)) fail("orphan", `review "${r.id}" não é linkada por nenhuma OUTRA página — mesma régua do artigo: sem clique, a review só existe para a busca`);
}

/* ── 8. Monetização honesta ───────────────────────────────────────────── */
const allText = [...HTML_FILES, "js/articles-db.js", "js/app.js"].map(read).join("\n");
/* O delimitador da URL é aspa/espaço, não "&": parar no & truncava
   `...?k=Foo&tag=x` em `...?k=Foo` e contava link com tag como sem tag. */
const amazonLinks = [...allText.matchAll(/https?:\/\/(?:www\.)?(amazon\.[a-z.]+|audible\.[a-z.]+)\/[^"'\s)]*/gi)];
/* No HTML atributos, "&" vira "&amp;": o regex precisa reconhecer ambos. */
const untagged = amazonLinks.filter((m) => !/[?&](?:amp;)?tag=/.test(m[0]));
if (untagged.length) warn("affiliate", `${untagged.length} links Amazon/Audible sem tag de afiliado (ex.: ${untagged[0][0].slice(0, 70)})`);
const tagCount = (allText.match(new RegExp(`tag=${PLACEHOLDER_TAG}`, "g")) || []).length;
if (tagCount) note("affiliate", `tag placeholder "${PLACEHOLDER_TAG}" em ${tagCount} links — trocar pela sua Store ID real antes de publicar`);
const otherTags = [...new Set([...allText.matchAll(/tag=([a-z0-9-]+)/gi)].map((m) => m[1]))];
if (otherTags.length > 1) warn("affiliate", `tags de afiliado inconsistentes entre si: ${otherTags.join(", ")}`);
for (const m of allText.matchAll(/(ADVERTISEMENT[^\n<]{0,60}|Lorem ipsum|TODO:|FIXME|placeholder text)/gi)) {
  warn("placeholder-copy", `texto de rascunho visível ao público: "${m[0].slice(0, 60)}"`);
}

/* ── 9. Cópias de head por matéria (tools/meta-pages.js) ────────────────── */
/* a-<id>.html e r-<id>.html são o que o Facebook/X leem. Se o catálogo mudou
   e a cópia não, o cartão compartilhado mostra o título antigo. */
if (!QUICK) {
  try {
    execFileSync(process.execPath, [path.join(ROOT, "tools", "meta-pages.js"), "--check"], { cwd: ROOT, stdio: "pipe" });
  } catch (err) {
    fail("meta-pages", "cópias a-<id>.html/r-<id>.html fora de sincronia com o catálogo (rode node tools/meta-pages.js)");
  }
}

/* ── 10. Memória do robô (pipeline/memory.json) ─────────────────────────── */
/* É a memória que impede o turno do Actions de reescolher a mesma pauta: sem
   ela, cada rodada acorda sem saber o que já foi publicado ou tentado. Fonte
   repetida no ar é o mesmo erro, só que visto pelo leitor — duas matérias com a
   mesma URL de fonte.                                                      */
const memLib = require("./lib/memory");
const memoria = (() => {
  const arquivo = path.join(ROOT, memLib.ARQUIVO);
  if (!fs.existsSync(arquivo)) {
    warn("memory", `${memLib.ARQUIVO} ainda não existe — a primeira rodada o cria; sem ele o teto diário e a fila perdem a memória`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(arquivo, "utf8"));
  } catch (err) {
    fail("memory", `${memLib.ARQUIVO} não é JSON válido: ${err.message}`);
    return null;
  }
})();
if (memoria) {
  const noAr = new Map();
  for (const item of [...DB.articles, ...DB.reviews]) {
    for (const s of item.sources || []) {
      if (!s || !s.url) continue;
      const chave = memLib.urlChave(s.url);
      noAr.set(chave, [...(noAr.get(chave) || []), item.id]);
    }
  }
  for (const [chave, ids] of noAr) {
    if (ids.length > 1) warn("source-dup", `mesma fonte citada por ${ids.length} matérias no ar: ${ids.join(", ")} (${chave.slice(0, 90)})`);
  }
  const ids = new Set([...DB.articles, ...DB.reviews].map((a) => a.id));
  for (const rec of Object.values(memoria.leads || {})) {
    if (rec && rec.outcome === "publicada" && rec.id && !ids.has(rec.id)) {
      warn("memory", `memória diz que "${rec.id}" está publicado, mas o catálogo não tem a matéria (publicação desfeita sem desfazer a memória)`);
    }
  }
}

/* ── 11. Cadência × agenda do Actions ─────────────────────────────────── */
/* O teto era desejo, não medida: com os horários de 07/10/14/17/21 UTC e
   distância mínima de 4h, a régua calcula 4 publicações possíveis contra uma
   meta declarada de 5 — e a rodada acordava verde sem publicar porque nada
   conferia a promessa com a agenda. Aqui a promessa vira número. */
const {
  parseCron,
  maxPublicacoesPorAgenda,
  menorIntervaloEntreHorarios,
  cronDoWorkflow,
  rodadasObservadas,
  horaNoFuso,
} = require("./lib/schedule");
{
  let cad = null;
  try {
    cad = JSON.parse(read("pipeline/cadence.json"));
  } catch (err) {
    fail("cadence", `pipeline/cadence.json não é JSON válido: ${err.message}`);
  }
  if (cad) {
    const teto = Number(cad.max_publishes_per_day) || 0;
    const ag = cronDoWorkflow(ROOT);
    /* Meta não conferida é meta inatingível: sem esta linha os dois travões
       abaixo só existiam enquanto o cron fosse parseável, e um cron com range ou
       step degradava tudo para aviso — a rodada seguia publicando contra um teto
       que ninguém tinha conferido. */
    if (ag.error) {
      fail("cadence", `não foi possível ler a agenda do workflow (${ag.error}) — com o teto de ${teto} sem conferência a rodada não publica; confira .github/workflows/turno.yml`);
    } else {
      const slots = parseCron(ag.cron);
      if (!slots) {
        fail("cadence", `cron "${ag.cron}" num formato que a régua não sabe ler (precisa ser minuto fixo + lista de horas) — o teto de ${teto}/dia não pode ser conferido contra a agenda`);
      } else {
        if (ag.cron.trim() !== String(cad.cron_expression || "").trim())
          fail("cadence", `pipeline/cadence.json anuncia cron "${cad.cron_expression}" mas o workflow executa "${ag.cron}" — duas réguas de agenda divergindo`);
        const possiveis = maxPublicacoesPorAgenda(slots.minutos, cad.min_hours_between_publishes);
        if (teto > possiveis)
          fail("cadence", `teto de ${teto} publicações/dia é inatingível com a agenda "${ag.cron}": respeitando ${cad.min_hours_between_publishes}h entre peças a agenda entrega no máximo ${possiveis}`);
        else
          note("cadence", `agenda "${ag.cron}" permite ${possiveis} publicações/dia (teto ${teto} · mínimo ${cad.min_hours_between_publishes}h · menor intervalo ${menorIntervaloEntreHorarios(slots.minutos)}h)`);
        if (cad.checks_per_day && Number(cad.checks_per_day) !== slots.minutos.length)
          warn("cadence", `checks_per_day diz ${cad.checks_per_day} mas o cron tem ${slots.minutos.length} horários`);
        const declaradas = (cad.check_hours || []).map(String).sort().join(" ");
        const reais = slots.minutos.map((m) => horaNoFuso(m, cad.timezone || "UTC")).sort().join(" ");
        if (declaradas && declaradas !== reais)
          warn("cadence", `check_hours (${declaradas}) não bate com o cron no fuso ${cad.timezone} (${reais})`);
      }
    }
    /* Entrega medida, não prometida. Rodada não é publicação: uma rodada que
       para no doctor, no teto ou na distância mínima conta como rodada e não
       publica nada, então comparar rodadas/dia com o teto de publicações
       acusava déficit onde só havia rodada de manutenção. Mede-se o que saiu
       (pipeline/memory.json, dia UTC) contra o teto. Atraso de cron é do
       GitHub, por isso é aviso — erro aqui faria o robô parar de publicar
       justamente quando o Actions está lento. Sem nenhum "turno:" no histórico,
       porém, o robô está desligado. */
    const obs = rodadasObservadas(ROOT, 7);
    const diasUTC = [...Array(7)].map((_, i) => new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)).reverse();
    const pubs = diasUTC.map((d) => memLib.publicacoesNoDia(ROOT, d));
    const mediaPubs = pubs.reduce((a, b) => a + b, 0) / 7;
    if (!obs) warn("cadence-entrega", "nenhum commit \"turno:\" nos últimos 7 dias — o robô não rodou nem no Actions nem aqui");
    else if (mediaPubs < teto)
      warn(
        "cadence-entrega",
        `saíram ${mediaPubs.toFixed(1)} publicações/dia nos 7 dias UTC ${diasUTC[0]}…${diasUTC[6]} (${pubs.join("/")}, o último ainda em curso) contra um teto de ${teto} — a agenda deu ${obs.porDia.toFixed(1)} rodadas/dia, então o que falta é pauta viável, nota acima do piso ou a rodada morre num travão de cadência`
      );
    else note("cadence-entrega", `${mediaPubs.toFixed(1)} publicações/dia em 7 dias UTC (teto ${teto} · ${obs.porDia.toFixed(1)} rodadas/dia)`);
    /* Furar o teto é decisão humana e continua sendo decisão humana — mas tem
       de ser contável. Com `forcada:true` no registro, a pergunta "quantas
       matérias entraram por fora da cadência nesta semana" deixa de ser
       arqueologia de TURNO.md e passa a ser uma linha da manutenção. */
    const forçadas = memLib.ler(ROOT).publishes.filter((p) => p.forcada && diasUTC.includes(String(p.at || "").slice(0, 10)));
    if (forçadas.length)
      warn("cadence-override", `${forçadas.length} publicação(ões) dos últimos 7 dias entraram com --force-cadence (${forçadas.map((p) => p.id).join(", ")}) — o teto de ${teto}/dia não valeu para elas`);
  }
}

/* ── 11b. Réguas da capa ──────────────────────────────────────────────── */
/* "2 trocas de capa por dia" foi commitado em 2026-11-06 e não funcionava no
   Actions: o estado mora em pipeline/state/, que era ignorado pelo git, então
   cada clone acordava com currentCoverId null e a troca "forçada" escolhia a
   matéria mais nova — que já era a capa. Além do arquivo versionado (agora),
   a rotação precisa de pelo menos duas matérias elegíveis: com uma só, não
   existe para onde girar, e a meta vira ruído permanente.
   Desde 2026-11-07 a unidade da capa é a RODADA, não a janela: a meta vale o
   número de horários do `check_hours`, e o doctor cobra que `cover_changes_per_day`
   seja exatamente esse número — régua de capa descolada da agenda é a mesma
   classe de defeito que produziu três semanas de verde sem publicar. */
{
  const coverState = require("./lib/cover-state");
  let cad11 = null;
  try {
    cad11 = JSON.parse(read("pipeline/cadence.json"));
  } catch {}
  if (cad11) {
    const coverRules = require("./lib/cover-rules");
    const piso = coverRules.pisoDaCapa(cad11);
    const notas = (() => {
      try {
        return JSON.parse(read("pipeline/scores.json")).scores || {};
      } catch {
        return {};
      }
    })();
    /* O MESMO filtro que o build.js usa para escolher a capa (lib/cover-rules).
       Refazer a conta a partir de scores.json aqui dava verde numa régua e
       vermelho na capa: dois critérios, dois resultados. */
    const elegiveis = coverRules.elegiveis(DB, piso);
    const melhor = Object.values(notas).reduce((m, r) => (r && typeof r.score === "number" && r.score > m ? r.score : m), 0);
    const metaCapa = Number(cad11.cover_changes_per_day) || 0;
    const rodadas = coverState.horariosDasRodadas();
    if (!rodadas.length)
      fail("cover", `pipeline/cadence.json sem check_hours legível — sem agenda não há como saber quantas rodadas o dia tem, e a meta de capa de ${metaCapa} não é cobrada de nada`);
    else if (metaCapa !== rodadas.length)
      fail("cover", `cover_changes_per_day = ${metaCapa} mas o cron dispara ${rodadas.length} rodadas/dia (check_hours) — a regra é girar a capa em TODA rodada, então a meta tem de ser ${rodadas.length}`);
    if (!elegiveis.length)
      warn("cover", `nenhuma matéria passa do piso ${piso} da capa (melhor nota medida: ${melhor || "nenhuma"}) — a capa fica com o HTML escrito à mão e a meta de ${metaCapa} troca(s)/dia não é cobrada de ninguém`);
    else if (elegiveis.length < 2 && metaCapa > 0)
      warn("cover", `só ${elegiveis.length} matéria elegível para a capa (${elegiveis[0].id}) — a rotação não tem para onde girar, então a meta de ${metaCapa} troca(s)/dia é impossível com este acervo`);
    else {
      note("cover", `${elegiveis.length} matérias elegíveis para a capa (piso ${piso}) · rodada atual ${coverState.rodadaId()} · ${rodadas.length} rodadas/dia`);
      if (rodadas.length && elegiveis.length < rodadas.length)
        note("cover", `ciclo de ${elegiveis.length} capa(s) para ${rodadas.length} rodadas/dia: cada matéria volta ao hero cerca de ${(rodadas.length / elegiveis.length).toFixed(1)}x por dia (nenhuma repetição em rodadas seguidas, que é o que a meta cobra)`);
    }
    if (cad11.timezone && cad11.timezone !== coverState.FUSO)
      warn("cover", `pipeline/cadence.json diz fuso "${cad11.timezone}" mas as rodadas da capa são contadas em "${coverState.FUSO}" — duas réguas de relógio`);
    const estado = coverState.loadState();
    if (!estado.changes.length) warn("cover", "pipeline/state/cover-state.json sem histórico de trocas — a meta de capa não está sendo medida (rode node tools/build.js uma vez para o arquivo entrar no repositório)");
    else
      note(
        "cover",
        `rodadas servidas no dia: ${coverState.rodadasServidasNoDia(estado)}/${metaCapa} (a rodada atual tem ${coverState.trocasNaRodada(estado)} troca(s)) · ${coverState.trocasNoDia(estado)} capa(s) ao ar no dia, ${estado.changes.length} trocas em ${coverState.DIA_LOG_DIAS} dias · capa atual ${estado.currentCoverId} · faltam ${elegiveis.filter((a) => !coverState.jaFoiCapa(estado, a.id)).length} inédita(s) para a rotação girar sozinha`
      );
  }
}

/* ── 11c. Réguas do TODAY'S PICKS ─────────────────────────────────────── */
/* O rótulo vende "as escolhas de HOJE", e o bloco era HTML escrito à mão com o
   par de 29/out e 23/out: quinze dias verde com o mesmo par, a mesma classe de
   defeito da capa que não girava. Desde 07/11 é slot com rotação por dia
   (lib/picks-rules) e o cadence.json cobra picks_changes_per_day. O doctor
   confere a régua, o mínimo de acervo para a troca ser possível por construção
   e — o que fecha o ciclo — se o par publicado no index.html É o par que a
   mesma função calcula para hoje. */
{
  const picksRules = require("./lib/picks-rules");
  let cad12 = null;
  let plc12 = null;
  try {
    cad12 = JSON.parse(read("pipeline/cadence.json"));
  } catch {}
  try {
    plc12 = JSON.parse(read("pipeline/placements.json"));
  } catch {}
  if (cad12 && plc12) {
    const metaPicks = cad12.picks_changes_per_day;
    const slot = (plc12.slots["index.html"] || []).find((s) => s.rotacao === "dia");
    if (metaPicks === undefined)
      fail("picks", "pipeline/cadence.json sem picks_changes_per_day — a régua do bloco TODAY'S PICKS mora no arquivo, não na conversa");
    else if (Number(metaPicks) !== 1)
      fail("picks", `picks_changes_per_day = ${metaPicks}, mas o bloco se vende como "hoje": a régua é exatamente 1 troca do bloco por dia`);
    if (!slot)
      fail("picks", 'nenhum slot com "rotacao": "dia" em pipeline/placements.json → index.html — sem slot o bloco volta a ser HTML escrito à mão, e nada gira o par');
    else {
      const html = read("index.html");
      const n = slot.limit || 2;
      const pool = picksRules.poolDePicks(DB.articles, slot, picksRules.excluidasDaRotacao(html));
      const minimo = picksRules.minimoParaRotacao(n);
      if (pool.length < minimo)
        fail("picks", `pool de "${slot.category}" com imagem = ${pool.length} peça(s); mínimo para trocar um bloco de ${n} cards todo dia é ${minimo} (lib/picks-rules.minimoParaRotacao) — com menos, o mesmo bloco sai hoje e amanhã e o rótulo "hoje" desmente a si mesmo`);
      const esperado = picksRules.picksDoDia(pool, n, picksRules.diaUtc()).map((a) => a.id);
      const noAr = [...picksRules.idsDaRegiao(html, slot.name)];
      if (!esperado.length)
        fail("picks", `nenhuma matéria ${slot.category} com imagem no catálogo — o bloco TODAY'S PICKS fica vazio`);
      else if (noAr.join("|") !== esperado.join("|"))
        fail("picks", `o index.html está com o bloco ${noAr.join(", ") || "(vazio)"} e a régua de hoje (dia UTC ${picksRules.diaUtc()}) manda ${esperado.join(", ")} — rode node tools/build.js; verde com o bloco velho no ar é exatamente o defeito de 15 dias que esta checagem existe para pegar`);
      const manual = (html.match(/class="pick-item"/g) || []).length - (picksRules.regiao(html, slot.name).match(/class="pick-item"/g) || []).length;
      if (manual > 0)
        fail("picks", `${manual} card(es) class="pick-item" FORA dos marcadores hwp:auto:${slot.name} — o bloco escrito à mão voltou, e ele é o que não mudava`);
      /* Duas conferências que NÃO espelham a função do build: se o pool de
         rotação errar (capa repetida na tela, card sem foto), build e doctor
         erram juntos e o espelho fica verde. Estas duas olham o HTML publicado
         contra o catálogo, cada uma por um caminho próprio. */
      const heroIds = picksRules.idsDaRegiao(html, "index-hero");
      const repetida = noAr.filter((id) => heroIds.has(id));
      if (repetida.length)
        fail("picks", `o bloco de picks repete a capa que já está no hero (${repetida.join(", ")}) — na mesma tela a matéria aparece duas vezes`);
      const semFoto = noAr.filter((id) => {
        const a = DB.articles.find((x) => x.id === id);
        return !a || !(a.bookCover || a.image);
      });
      if (semFoto.length)
        fail("picks", `card(s) do bloco TODAY'S PICKS sem artigo no catálogo ou sem imagem: ${semFoto.join(", ")} — o card é feito em volta da foto`);
      if (!manual && esperado.length && noAr.join("|") === esperado.join("|"))
        note("picks", `bloco de hoje no ar: ${esperado.join(", ")} · pool ${pool.length} peça(s) de ${slot.category} com imagem · troca 1x/dia, offset ${(picksRules.diaUtc() % pool.length + pool.length) % pool.length} do ciclo de ${pool.length}`);
    }
  }
}

/* ── 11d. Markup solto: card de slot escrito à mão fora dos marcadores ─── */
/* O TODAY'S PICKS foi o primeiro bloco a ganhar régua, e a mesma classe de
   defeito estava viva no resto da home: 16 cards escritos à mão fora dos
   hwp:auto em index.html (4 em MOST RECENT, 6 em CULTURE, 6 em TECH/SCIENCE)
   e mais 12 nas páginas de categoria. Pior do que não mudar: o build conta os
   ids que já aparecem no arquivo para não repetir matéria, então cada card
   solto rouba uma vaga do próprio slot — a CULTURE tinha limit 6 e gerava 3.
   Um card solto que aponta para fora do catálogo (o Dumarest restaurado em
   dumarest/index.htm, por exemplo) continua sendo curadoria válida e não é
   contado aqui. */
{
  const markup = require("./lib/slot-markup");
  const picksRules = require("./lib/picks-rules");
  let plc14 = null;
  try {
    plc14 = JSON.parse(read("pipeline/placements.json"));
  } catch {}
  if (!plc14) {
    fail("slot-stale", "pipeline/placements.json ilegível — sem a lista de slots o doctor não sabe o que é automático");
  } else {
    const noCatalogo = new Set([...DB.articles.map((a) => a.id), ...(DB.reviews || []).map((r) => r.id)]);
    let conferidos = 0;
    let curados = 0;
    for (const [file, slots] of Object.entries(plc14.slots)) {
      const html = read(file);
      if (html === undefined) continue;
      const regioes = markup.regioesDoArquivo(html, slots);
      for (const slot of slots) {
        const cls = markup.cardClassOf(slot.template);
        const fora = markup.cardsPorClasse(html, cls, regioes).fora.map((p) => markup.idDoCard(html, p));
        curados += fora.filter((id) => !id || !noCatalogo.has(id)).length;
        const soltos = fora.filter((id) => id && noCatalogo.has(id));
        if (soltos.length)
          fail(
            "slot-stale",
            `${file}: ${soltos.length} card(es) class="${cls}" FORA dos marcadores hwp:auto:${slot.name} (${soltos.slice(0, 3).join(", ")}${soltos.length > 3 ? ", …" : ""}) — card de matéria escrito à mão não é regenerado por ninguém e ainda rouba vaga do slot, que é como a CULTURE ficou com 3 das 6 peças`,
          );
        const gerados = markup.cardsNaRegiao(html, slot);
        if (slot.limit && gerados < slot.limit) {
          const acervo = DB.articles.filter((a) => (slot.category ? a.category === slot.category : true)).length;
          warn(
            "slot-vazio",
            `${file} · ${slot.name}: ${gerados} card(s) gerados contra um limit de ${slot.limit} (acervo elegível no catálogo: ${acervo} ${slot.category ? slot.category + " " : ""}peça(s)) — falta matéria ou o markup solto do arquivo ainda está descontando da fila`,
          );
        }
        if (slot.dedup === "prioridade-ineditas") {
          /* O feed de categoria é o acervo e a curadoria do topo já mostrou
             parte dele: repetir é inevitável com um catálogo fino, mas a ordem
             é régua — o leitor desce, e o primeiro card não pode ser a matéria
             que ele acabou de ler no spotlight. Verde com repetição no topo foi
             o que o supervisor pegou em 09/11, depois do "dedup: nenhum". */
          const i0 = html.indexOf(markup.marcador(slot.name, "start"));
          const acima = new Set([...html.slice(0, i0).matchAll(/[a-z0-9-]+\.html\?id=([^&"']+)/gi)].map((x) => decodeURIComponent(x[1])));
          const ordem = [...picksRules.idsDaRegiao(html, slot.name)];
          const marcas = ordem.map((id) => (acima.has(id) ? 1 : 0));
          const primeiroRepetido = marcas.indexOf(1);
          const ultimaInedita = marcas.lastIndexOf(0);
          if (primeiroRepetido >= 0 && ultimaInedita > primeiroRepetido)
            fail(
              "slot-stale",
              `${file} · ${slot.name}: o card ${primeiroRepetido + 1} do feed repete matéria que já está acima dele, e há inédita mais abaixo (posições ${marcas.map((v, k) => (v === 0 ? k + 1 : 0)).filter(Boolean).join(",")}) — com dedup "prioridade-ineditas" a inédita vem primeiro e a repetição afunda; rode node tools/build.js`,
            );
        }
        if (slot.acervo) {
          /* O cap de 8 cards foi o que escondeu a cauda do catálogo: em 09/11,
             com 15 peças science a página listava 11, e com 10 de cultura
             listava 8 — as peças cortadas não eram as mais velhas, eram as que
             o `slice` alcançava, e duas delas (uma de cada editoria) não
             tinham link de entrada em lugar nenhum do site. Com "acervo": true
             a página da editoria tem de listar TODA a editoria — e o [orphan]
             de cima garante o mesmo pelo lado do catálogo, não pelo markup. */
          const daEditoria = DB.articles.filter((a) => (slot.category ? a.category === slot.category : true)).map((a) => a.id);
          const publicados = new Set(picksRules.idsDaRegiao(html, slot.name));
          const deFora = daEditoria.filter((id) => !publicados.has(id));
          if (deFora.length)
            fail(
              "slot-stale",
              `${file} · ${slot.name}: o slot é "acervo" mas faltam ${deFora.length} peça(s) da editoria na lista (${deFora.slice(0, 3).join(", ")}${deFora.length > 3 ? ", …" : ""}) — a página de editoria é o arquivo dela; rode node tools/build.js`,
            );
        }
        if (slot.count_pill) {
          const alvo = slot.count_pill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const m = html.match(new RegExp(`<[^>]*${alvo}[^>]*>[^<()]*\\((\\d+)\\)`));
          if (!m) fail("slot-stale", `${file}: rótulo com count_pill="${slot.count_pill}" não existe mais — o build não tem onde escrever o número da grade`);
          else if (Number(m[1]) !== gerados)
            fail("slot-stale", `${file}: o rótulo diz (${m[1]}) e a grade hwp:auto:${slot.name} tem ${gerados} card(s) — o número é consequência da grade; rode node tools/build.js`);
        }
        conferidos++;
      }
    }
    if (conferidos)
      note("slot-stale", `${conferidos} slot(s) automáticos conferidos em ${Object.keys(plc14.slots).length} arquivo(s): nenhum card de matéria fora dos marcadores · ${curados} card(s) curado(s) (fora do catálogo) mantido(s) à mão`);
  }
}

/* ── 12. Links externos (rede) ────────────────────────────────────────── */
async function checkExternal(url) {
  const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36", Accept: "*/*" };
  for (const method of ["HEAD", "GET"]) {
    try {
      const res = await fetch(url, { method, headers, redirect: "follow", signal: AbortSignal.timeout(15000) });
      if (method === "HEAD" && res.status >= 400) continue;
      return { status: res.status, finalUrl: res.url };
    } catch {}
  }
  return { status: 0, finalUrl: url };
}
if (OFFLINE || QUICK) {
  note("external", "verificação de links externos pulada (--offline/--quick)");
  writeReport();
} else {
  const isImage = (u) => /\.(jpe?g|png|svg|webp|gif)$/i.test(u.split("?")[0]);
  const isBareOrigin = (u) => /^https?:\/\/[^/]+\/?$/.test(u);
  const external = [...new Set([...allText.matchAll(/https?:\/\/[^"'\s<>)]+/g)].map((m) => m[0]))].filter(
    (u) => !u.includes("homeworldpress.com") && !isBareOrigin(u) && (isImage(u) || !/\.(css|js)$/i.test(u.split("?")[0])),
  );
  const queue = external.slice(0, 120);
  let checked = 0;
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      const r = await checkExternal(url);
      checked++;
      if (r.status === 0) warn("external-timeout", `sem resposta (pode ser bloqueio de bot): ${url.slice(0, 100)}`);
      else if ([401, 403, 406, 429].includes(r.status)) warn("external-blocked", `HTTP ${r.status} — bloqueio a robô, abrir manualmente: ${url.slice(0, 100)}`);
      else if (r.status >= 400) fail("external-broken", `HTTP ${r.status}: ${url.slice(0, 100)}`);
      else if (r.status >= 300 && /404|not-found/i.test(r.finalUrl)) fail("external-soft-404", `redireciona para página de erro: ${url.slice(0, 90)}`);
    }
  };
  (async () => {
    await Promise.all(Array.from({ length: 8 }, worker));
    note("external", `${checked}/${external.length} links externos verificados (amostra limitada a 120)`);
    writeReport();
  })();
}

/* ── Relatório ────────────────────────────────────────────────────────── */
function writeReport() {
const today = new Date().toISOString().slice(0, 10);
const byCheck = (list) => {
  const g = new Map();
  for (const item of list) {
    if (!g.has(item.check)) g.set(item.check, []);
    g.get(item.check).push(item.msg);
  }
  return g;
};
const render = (title, list) => {
  if (!list.length) return `## ${title}\n\nNada encontrado.\n`;
  let out = `## ${title} (${list.length})\n\n`;
  for (const [check, msgs] of byCheck(list)) out += `### \`${check}\`\n` + msgs.map((m) => `- ${m}`).join("\n") + "\n\n";
  return out;
};
const report = [
  `# Doctor report — ${today}`,
  "",
  `Comando: \`node tools/doctor.js ${ARGS.join(" ")}\``,
  `Catálogo: ${DB.articles.length} artigos, ${DB.reviews.length} reviews, ${HTML_FILES.length} páginas HTML.`,
  `**${errors.length} erros · ${warnings.length} avisos**`,
  "",
  render("ERROS", errors),
  render("AVISOS", warnings),
  render("INFORMAÇÕES", infos),
].join("\n");

fs.mkdirSync(path.join(ROOT, "tools", "reports"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "tools", "reports", `${today}.md`), report);

const icon = (list) => (list.length ? "✗" : "✓");
console.log(`${icon(errors)} errors ${errors.length} | ${icon(warnings)} warnings ${warnings.length} | ${DB.articles.length} articles, ${DB.reviews.length} reviews, ${HTML_FILES.length} pages`);
for (const e of errors.slice(0, 25)) console.log(`  ERRO  [${e.check}] ${e.msg}`);
for (const w of warnings.slice(0, 25)) console.log(`  aviso [${w.check}] ${w.msg}`);
if (errors.length > 25) console.log(`  … e mais ${errors.length - 25} erros`);
if (warnings.length > 25) console.log(`  … e mais ${warnings.length - 25} avisos`);
console.log(`relatório completo: tools/reports/${today}.md`);
process.exit(errors.length ? 1 : 0);
}
