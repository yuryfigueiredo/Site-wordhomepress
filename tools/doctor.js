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
const ORIGIN = "https://homeworldpress.com";
const PLACEHOLDER_TAG = "homeworldpres-20";

global.window = {};
require(path.join(ROOT, "js", "articles-db.js"));
const DB = global.window.HWP_DATABASE;

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
    const rel = path.normalize(path.join(base, bare.replace(/^\/+/, ""))).replace(/\\/g, "/");
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
    const target = path.normalize(path.join(path.dirname(file), raw.split("?")[0]));
    if (!fs.existsSync(path.join(ROOT, target))) {
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
const staticText = HTML_FILES.filter((f) => !NOINDEX_PAGES.includes(f)).map(read).join("\n");
for (const a of DB.articles) {
  const linked = staticText.includes(`id=${a.id}`) || staticText.includes(`"${a.id}"`);
  if (!linked) warn("orphan", `artigo "${a.id}" não é linkado por nenhuma página — só alcançável pela busca`);
}

/* ── 8. Monetização honesta ───────────────────────────────────────────── */
const allText = [...HTML_FILES, "js/articles-db.js", "js/app.js"].map(read).join("\n");
/* O delimitador da URL é aspa/espaço, não "&": parar no & truncava
   `...?k=Foo&tag=x` em `...?k=Foo` e contava link com tag como sem tag. */
const amazonLinks = [...allText.matchAll(/https?:\/\/(?:www\.)?(amazon\.[a-z.]+|audible\.[a-z.]+)\/[^"'\s)]*/gi)];
const untagged = amazonLinks.filter((m) => !/[?&]tag=/.test(m[0]));
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

/* ── 11. Links externos (rede) ────────────────────────────────────────── */
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
