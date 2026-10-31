/* check-post.js — o editor mecânico. Valida pipeline/drafts/<slug>/draft.json
   contra o output contract e as rejeições de voice/WRITER_PROMPT.md, sem modelo:
   tudo aqui é medido no texto, não declarado pelo modelo.

   Uso:
     node tools/check-post.js <slug>
     node tools/check-post.js <slug> --offline   # pula a checagem de rede
   Saída: pipeline/drafts/<slug>/review.md · exit 1 quando reprova.            */
const fs = require("fs");
const path = require("path");
const memLib = require("./lib/memory");

const ROOT = path.resolve(__dirname, "..");
const SLUG = process.argv[2];
const OFFLINE = process.argv.includes("--offline");
if (!SLUG) {
  console.error("uso: node tools/check-post.js <slug>");
  process.exit(2);
}

const DIR = path.join(ROOT, "pipeline", "drafts", SLUG);
const DRAFT_FILE = path.join(DIR, "draft.json");
if (!fs.existsSync(DRAFT_FILE)) {
  console.error(`não existe ${path.relative(ROOT, DRAFT_FILE)}`);
  process.exit(2);
}

global.window = {};
require(path.join(ROOT, "js", "articles-db.js"));
const DB = global.window.HWP_DATABASE;

const raw = fs.readFileSync(DRAFT_FILE, "utf8").replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
let draft;
try {
  draft = JSON.parse(raw);
} catch (err) {
  console.error(`draft.json não é JSON válido: ${err.message}`);
  process.exit(1);
}

const problems = [];
const notes = [];
const reject = (gate, msg) => problems.push({ gate, msg });
const note = (gate, msg) => notes.push({ gate, msg });

/* ── utilidades de texto ──────────────────────────────────────────────── */
const ALLOWED_TAGS = ["p", "h2", "h3", "ul", "ol", "li", "blockquote", "strong", "em", "a"];
const stripTags = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const paragraphs = (html) =>
  String(html || "")
    .split(/<\/(?:p|li|h2|h3|blockquote)>/i)
    .map(stripTags)
    .filter((t) => t.length > 1);
const sentences = (text) =>
  String(text)
    .replace(/\s+/g, " ")
    .match(/[^.!?]+[.!?]+(?:["')\]]+)?/g) || [];
const words = (s) => s.trim().split(/\s+/).filter(Boolean);
const round2 = (n) => Math.round(n * 100) / 100;

const text = stripTags(draft.content || draft.prose);
const paras = paragraphs(draft.content || draft.prose);
const sents = sentences(text);

/* Links do corpo, lidos da tag inteira e não por regex de texto: o valor de
   um atributo pode conter ">", e aí <a title="x>y" href="..."> escondia o
   href. Decodificar entidades e tirar controles antes de olhar o esquema
   fecha "jav&#x61;script:" e "java&Tab;script:". */
const A_TAG_RE = /<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const ATTR_RE = /[\/\s]*([a-z][a-z0-9:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+))/gi;
const NAMED_ENTITIES = { tab: "\t", newline: "\n", colon: ":", quest: "?", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeEntities = (s) =>
  String(s)
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&(tab|newline|colon|quest|amp|lt|gt|quot|apos);/gi, (_, name) => NAMED_ENTITIES[name.toLowerCase()]);
const anchors = [...String(draft.content || "").matchAll(A_TAG_RE)].map((tag) => {
  const attrs = [...tag[1].matchAll(ATTR_RE)].map((attr) => ({
    name: attr[1].toLowerCase(),
    value: decodeEntities(attr[2] ?? attr[3] ?? attr[4] ?? "").replace(/[\u0000-\u0020\u007f]/g, ""),
  }));
  return { hasHref: attrs.some((a) => a.name === "href"), hrefs: attrs.filter((a) => a.name === "href").map((a) => a.value) };
});
const hrefs = anchors.flatMap((a) => a.hrefs);

/* ── 1. schema ────────────────────────────────────────────────────────── */
const REQUIRED = ["id", "title", "dek", "kicker", "category", "subtopic", "author", "date", "readTime", "content", "sources", "evidence_level", "self_check"];
for (const key of REQUIRED) if (draft[key] === undefined || draft[key] === null || draft[key] === "") reject("schema", `campo obrigatório ausente: ${key}`);
if (!["culture", "tech", "science"].includes(draft.category)) reject("schema", `category inválida: ${draft.category}`);
const dateMatch = String(draft.date || "").match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s+(\d{4})$/);
if (!dateMatch) {
  reject("schema", `date fora do padrão "Mon DD, YYYY": ${draft.date}`);
} else {
  /* "Feb 31, 2026" cabia no padrão e virava datePublished inválido no JSON-LD. */
  const MONTHS_SHORT = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const month = MONTHS_SHORT.indexOf(dateMatch[1].toUpperCase().slice(0, 3)) + 1;
  const day = Number(dateMatch[2]);
  const dt = new Date(Date.UTC(Number(dateMatch[3]), month - 1, day));
  if (!month || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) reject("schema", `data impossível no calendário: ${draft.date}`);
}
if (!/^\d+\s*MIN READ$/i.test(draft.readTime || "")) reject("schema", `readTime fora do padrão "N MIN READ": ${draft.readTime}`);
if (!/^[a-z0-9-]+$/.test(draft.id || "")) reject("schema", `id não é kebab-case: ${draft.id}`);
if (DB.articles.some((a) => a.id === draft.id)) reject("schema", `id já publicado: ${draft.id}`);

/* ── 2. tags permitidas no content ────────────────────────────────────── */
const foreignTags = [...String(draft.content || "").matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g)]
  .map((m) => m[1].toLowerCase())
  .filter((t) => !ALLOWED_TAGS.includes(t));
if (foreignTags.length) reject("content-tags", `tags fora do permitido (${ALLOWED_TAGS.join(", ")}): ${[...new Set(foreignTags)].join(", ")}`);
if (anchors.some((a) => !a.hasHref)) reject("content-tags", "<a> sem href");
if (/style\s*=|<script|on\w+\s*=/i.test(draft.content || "")) reject("content-tags", "atributo de estilo/script inline no content");

/* ── 3. vocabulário banido (lista única em WRITER_PROMPT.md) ──────────── */
const wp = fs.readFileSync(path.join(ROOT, "voice", "WRITER_PROMPT.md"), "utf8");
const bannedLine = (wp.match(/^BANNED\n(.+)$/m) || [])[1] || "";
const banned = bannedLine.split(";").map((s) => s.trim().toLowerCase()).filter(Boolean);
const lower = text.toLowerCase();
for (const phrase of banned) {
  if (phrase.includes(" as a verb") || phrase.includes(" outside ")) continue;
  if (lower.includes(phrase)) reject("banned-lexical", `frase banida presente: "${phrase}"`);
}
for (const w of ["ultimate", "essential", "everything", "game-changer", "must-have"]) {
  if (new RegExp(`\\b${w}\\b`, "i").test(draft.title || "")) reject("banned-lexical", `palavra banida no título: ${w}`);
}

/* ── 4. frases-template estruturais ───────────────────────────────────── */
const TEMPLATES = [
  [/\bit is not [^.]{3,80}, it is [^.]{3,80}\./i, "antithesis 'it is not X, it is Y'"],
  [/\bis not the point\. /i, "antithesis 'X is not the point'"],
  [/\bthe (?:lazy|easy|usual) explanation is\b/i, "antithesis 'the lazy explanation is'"],
  [/\bthat is the (?:highest compliment|whole point)\b/i, "fecho autoelogioso"],
  [/\bwhich is the point\b/i, "fecho autoelogioso"],
  [/\bwhat matters is\b/i, "'what matters is'"],
  [/\bthe point is\b/i, "'the point is'"],
  [/\bhere'?s the thing\b/i, "'here's the thing'"],
  [/\bit'?s worth noting\b/i, "'it's worth noting'"],
  [/\bmake no mistake\b/i, "'make no mistake'"],
  [/\bnot only [^.]{3,80} but\b/i, "'not only X but Y'"],
  [/\band that changes everything\b/i, "'and that changes everything'"],
  [/\bin a world where\b/i, "'in a world where'"],
  [/\bat a moment when\b/i, "'at a moment when'"],
  [/\bfor the first time in \d+ years\b/i, "'for the first time in N years' sem N verificável"],
  [/\bonly time will tell\b/i, "'only time will tell'"],
  [/\bremains to be seen\b/i, "'remains to be seen'"],
  [/\bthe future will decide\b/i, "'the future will decide'"],
  [/\bif you take one thing from this\b/i, "'if you take one thing from this'"],
  [/\bthe real question is\b/i, "'the real question is'"],
];
const hits = [];
for (const [re, label] of TEMPLATES) if (re.test(text)) hits.push(label);
if (hits.length > 1) reject("banned-template", `${hits.length} templates estruturais (máximo 1): ${hits.join("; ")}`);
const lastSentence = sents[sents.length - 1] || "";
for (const [re, label] of TEMPLATES) if (re.test(lastSentence)) reject("banned-template", `template estrutural usado como fecho: ${label}`);
if (hits.length === 1) note("banned-template", `1 template estrutural presente (limite é 1): ${hits[0]}`);

/* ── 5. ritmo ─────────────────────────────────────────────────────────── */
const lengths = paras.map((p) => sentences(p).length);
const sentLengths = sents.map((s) => words(s).length);
const shortest = Math.min(...sentLengths);
const longest = Math.max(...sentLengths);
if (longest > 30) reject("rhythm", `frase com ${longest} palavras (máximo 30)`);
if (shortest >= 8) reject("rhythm", `frase mais curta tem ${shortest} palavras — falta a frase curta obrigatória`);
if (!paras.some((p) => words(p).length === 1 || sentences(p).length === 1)) reject("rhythm", "nenhum parágrafo de uma frase");
if (!paras.some((p) => sentences(p).length >= 4)) reject("rhythm", "nenhum parágrafo longo (4+ frases) — ritmo uniforme");
const sc = draft.self_check || {};
/* Medição é trabalho da máquina, não do modelo: contar palavras e parágrafos
   é objetivo, e um modelo que erra a conta não tem texto pior por isso. Antes
   isso reprovava três vezes e a peça nunca passava. O que continua sendo
   julgamento do modelo (opening_move, humor, tese) segue como ele declarou. */
if (draft.self_check) {
  const antes = `${sc.word_count}/${sc.shortest_sentence_words}/${JSON.stringify(sc.paragraph_lengths)}`;
  sc.word_count = words(text).length;
  sc.shortest_sentence_words = shortest;
  sc.paragraph_lengths = lengths;
  const depois = `${sc.word_count}/${sc.shortest_sentence_words}/${JSON.stringify(sc.paragraph_lengths)}`;
  if (antes !== depois) {
    fs.writeFileSync(path.join(DIR, "draft.json"), JSON.stringify(draft, null, 2) + "\n");
    note("self-check", `medições refeitas pela máquina: modelo declarou ${antes}, o texto tem ${depois}`);
  }
}
const micDrops = paras.filter((p) => sentences(p).length === 1).length;
if (micDrops > 2) reject("rhythm", `${micDrops} parágrafos de uma frase (máximo 2)`);

/* ── 6. humor e tom ───────────────────────────────────────────────────── */
const grim = /obituar|died|death|crash|disaster|traged|killed|funeral/i.test(`${draft.title} ${text.slice(0, 400)}`);
const humor = Number(sc.humor_lines || 0);
if (humor > 2) reject("tone", `${humor} linhas de humor (máximo 2)`);
if (grim && humor > 0) reject("tone", "linha de humor em pauta de morte/desastre");

/* ── 7. repetição contra a memória e contra o catálogo ────────────────── */
const lastRuns = JSON.parse(fs.readFileSync(path.join(ROOT, "voice", "state", "last_runs.json"), "utf8"));
/* O contrato não tem campo register — quem sabe o registro é o brief. */
let REGISTER = draft.register;
try { REGISTER = JSON.parse(fs.readFileSync(path.join(DIR, "brief.json"), "utf8")).register || REGISTER; } catch {}
const mem = (lastRuns.runs || {})[REGISTER] || null;
if (mem && mem.opening_move && sc.opening_move === mem.opening_move)
  reject("repetition", `opening_move "${sc.opening_move}" igual ao da última peça do registro ${REGISTER}`);
if (mem && mem.ending_move && sc.ending_move === mem.ending_move)
  reject("repetition", `ending_move "${sc.ending_move}" igual ao da última peça do registro ${REGISTER}`);
const opening = words(sents[0] || "").slice(0, 4).join(" ").toLowerCase();
for (const a of DB.articles.slice(0, 6)) {
  const pub = words(stripTags(a.content)).slice(0, 4).join(" ").toLowerCase();
  if (opening && opening === pub) reject("repetition", `abertura idêntica à de "${a.id}"`);
}
if (!sc.opening_move || !sc.ending_move) reject("repetition", "self_check sem opening_move/ending_move — impossível auditar repetição");

/* ── 8. fontes e números ──────────────────────────────────────────────── */
const sources = Array.isArray(draft.sources) ? draft.sources : [];
if (draft.evidence_level === "sourced" && sources.length === 0) reject("sources", "evidence_level=sourced sem nenhuma fonte");
if (draft.evidence_level === "analysis_only") {
  const numbers = text.match(/\d+(?:\.\d+)?%|\$\d[\d,.]*/g) || [];
  if (numbers.length) reject("sources", `analysis_only mas o texto traz números específicos: ${numbers.slice(0, 5).join(", ")}`);
}
/* O corpo é inserido como HTML na página: um href javascript:/data: escrito
   pelo modelo viraria link executável. Os links já vêm lidos da tag em
   `anchors` (aspas respeitadas, entidades decodificadas, controles fora). */
const unsafeHref = hrefs.filter((href) => /^(?:javascript|data|vbscript):/i.test(href));
if (unsafeHref.length) reject("sources", `link com esquema não permitido no texto: ${unsafeHref[0].slice(0, 60)}`);

/* O box de afiliado não passa por app.js nas páginas de feed: o valor vira
   href estático, então só http(s) pode entrar. */
const boxUrls = Object.entries(draft.affiliateBox || {})
  .filter(([key, value]) => /url$/i.test(key) && typeof value === "string" && value.trim() !== "");
for (const [key, value] of boxUrls) {
  const probe = decodeEntities(value).replace(/[\u0000-\u0020\u007f]/g, "");
  if (!/^https?:\/\//i.test(probe)) reject("sources", `affiliateBox.${key} fora de http(s): ${value.slice(0, 60)}`);
}

/* Link "//host/x" resolve para http(s) na página e não passava pelo teste:
   normaliza para https antes de conferir se está nas fontes. */
const contentLinks = hrefs
  .map((href) => (/^\/\//.test(href) ? `https:${href}` : href))
  .filter((href) => /^https?:/i.test(href));
for (const link of contentLinks) {
  /* a mesma URL com barra no cabo ou utm_ não é outro link: comparar cru
    gastava uma das três reescritas por cosmética */
  const chave = memLib.urlChave(link);
  const known = sources.some((s) => memLib.urlChave(s.url) === chave) || /amazon\.|audible\./.test(link) || link.startsWith("https://homeworldpress.com");
  if (!known) reject("sources", `link no texto que não está nas fontes: ${link.slice(0, 90)}`);
}
const numbersInText = (text.match(/\d+(?:\.\d+)?%|\$\d[\d,.]*/g) || []).length;
const numbersWithoutSource = sources.length === 0 ? numbersInText : 0;

/* Fonte repetida é a forma mais barata de quase-duplicata: a rodada seguinte
   reescreve a mesma notícia com outro título e passa pelos outros portões.
   A definição de "já publicada" é a mesma do pick-lead (lib/memory), para as
   duas decisões não divergirem. */
const publishedUrls = memLib.fontesPublicadas(DB, draft.id);
const reused = sources.find((s) => publishedUrls.has(memLib.urlChave(s.url)));
if (reused) reject("sources", `fonte já usada em matéria publicada: ${reused.url}`);

/* Frase repetida é enchimento para alcançar o piso de palavras — o texto do
   turno de 2026-10-31 repetiu "The data were collected in the infrared." 15x. */
const sentenceCount = new Map();
for (const s of sents) {
  const key = s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (key.length < 30) continue;
  sentenceCount.set(key, (sentenceCount.get(key) || 0) + 1);
}
const repeated = [...sentenceCount].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
if (repeated.length)
  reject("repetition", `frase repetida ${repeated[0][1]}x: "${repeated[0][0].slice(0, 70)}…"`);

/* A data do fato tem de caber na data da fonte. Sem isso o redator datava a
   notícia de hoje e a nota de atualidade aprovava o texto. */
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const datelines = [
  ...text.matchAll(/\b(?:On|In) (January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})/gi)
    .map((m) => Date.UTC(Number(m[3]), MONTHS[m[1].toLowerCase()] - 1, Number(m[2]))),
  /* O redator também escreve data ISO ("On 2026-11-05"); sem esta linha o
     portão só via o formato por extenso. */
  ...[...text.matchAll(/\b(?:On|In) (\d{4})-(\d{2})-(\d{2})\b/gi)]
    .map((m) => Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))),
];
const sourceDates = sources.map((s) => Date.parse(s.date)).filter((t) => !isNaN(t));
if (datelines.length && sourceDates.length) {
  const newest = Math.max(...sourceDates);
  const latestDateline = Math.max(...datelines);
  if (latestDateline > newest + 86400000)
    reject("sources", `data no texto (${new Date(latestDateline).toISOString().slice(0, 10)}) posterior à fonte mais recente (${new Date(newest).toISOString().slice(0, 10)})`);
}
if (sourceDates.some((t) => t > Date.now() + 86400000)) reject("sources", "fonte com data no futuro");

/* ── 9. a regra do "nós testamos" ───────────────────────────────────────── */
const testedClaim = /\bwe tested\b|\bour tests?\b|\bwe measured\b|\bin our lab\b/i.test(text);
const testedProducts = (draft.products || []).filter((p) => p.tested && String(p.test_notes || "").length > 20);
if (testedClaim && testedProducts.length === 0)
  reject("tested-rule", 'o texto diz "we tested" sem products[].tested=true e test_notes com protocolo (horas, aparelho, ambiente, critérios)');
if (testedClaim && testedProducts.length) note("tested-rule", `alegação de teste apoiada por ${testedProducts.length} protocolo(s) registrado(s)`);
if (/\bbest\b/i.test(draft.title || "") && !/for |in |under /i.test(draft.title || ""))
  reject("tested-rule", '"best" no título sem categoria ("best X for Y")');
if (/before (?:the )?prices? (?:spike|rise|jump)|don'?t miss out|grab it now|limited time/i.test(text))
  reject("tested-rule", "urgência artificial de afiliado no texto");

/* ── 10. título e dek ─────────────────────────────────────────────────── */
if (!draft.image && !draft.bookCover)
  reject("image", "sem image nem bookCover: todo card do site tem miniatura, e src vazio aparece quebrado para o leitor");
const titleWords = words(draft.title || "").length;
if (titleWords < 6 || titleWords > 14) reject("title", `título com ${titleWords} palavras (faixa 6–14)`);
if (/\?/.test(draft.title || "")) reject("title", "título em forma de pergunta");
if (/:\s*$/.test(draft.title || "")) reject("title", "título terminando em dois-pontos decorativo");
if (stripTags(draft.dek).toLowerCase().split(/\s+/).slice(0, 6).join(" ") === stripTags(draft.title).toLowerCase().split(/\s+/).slice(0, 6).join(" "))
  reject("title", "dek repete o título");

/* ── 10b. bloco ranking (a nota é calculada, o modelo só justifica) ────── */
if (draft.ranking !== undefined) {
  const r = draft.ranking || {};
  if (typeof r.thesis_strength !== "number" || r.thesis_strength < 0 || r.thesis_strength > 2)
    reject("ranking", "ranking.thesis_strength precisa ser número de 0 a 2");
  const why = String(r.why || "").trim();
  if (why.length < 20) reject("ranking", "ranking.why precisa de uma linha de justificativa real (20+ caracteres)");
  if (words(why).length > 25) reject("ranking", `ranking.why tem ${words(why).length} palavras (máximo 25)`);
  if (typeof r.score === "number") reject("ranking", "o modelo não pode declarar ranking.score — a nota é calculada por tools/score.js");
}

/* ── 11. rede (fontes e imagem) ────────────────────────────────────────── */
async function net() {
  if (OFFLINE) {
    note("network", "checagem de rede pulada (--offline)");
    return;
  }
  const check = async (url, label) => {
    try {
      const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(15000), headers: { "User-Agent": "Mozilla/5.0 (compatible; HomeworldPressBot/1.0)" } });
      if (res.status >= 400) reject("network", `${label} devolve HTTP ${res.status}: ${url.slice(0, 90)}`);
      else note("network", `${label} ok (${res.status})`);
    } catch (err) {
      note("network", `${label} sem resposta (bloqueio de robô?), abrir manualmente: ${url.slice(0, 80)}`);
    }
  };
  for (const s of sources.slice(0, 8)) await check(s.url, "fonte");
  if (draft.image && /^https?:/.test(draft.image)) await check(draft.image, "imagem");
  if (draft.image && !/^https?:/.test(draft.image)) {
    const abs = path.join(ROOT, draft.image.replace(/^\/+/, ""));
    if (!fs.existsSync(abs)) reject("image", `imagem local não existe: ${draft.image}`);
  }
}

net().then(() => {

/* ── veredito ─────────────────────────────────────────────────────────── */
const today = new Date().toISOString().slice(0, 10);
const measured = words(text).length;
let targetWords = 0;
try { targetWords = Number(JSON.parse(fs.readFileSync(path.join(DIR, "brief.json"), "utf8")).word_count || 0); } catch {}
/* Texto muito abaixo do combinado no brief é modelo preguiçoso, não estilo:
   200 palavras onde a pauta pedia 1100 vira página fina no índice. O piso é
   70% do alvo (770 para uma pauta de 1100), o mesmo número que o prompt pede. */
if (targetWords && measured < targetWords * 0.7)
  reject("length", `texto com ${measured} palavras para uma pauta de ~${targetWords} — o piso é ${Math.round(targetWords * 0.7)}`);
fs.writeFileSync(
  path.join(DIR, "metrics.json"),
  JSON.stringify(
    {
      id: draft.id,
      measured_at: new Date().toISOString(),
      word_count: measured,
      target_word_count: targetWords,
      word_count_ratio: targetWords ? round2(measured / targetWords) : 1,
      paragraphs: paras.length,
      shortest_sentence_words: shortest,
      longest_sentence_words: longest,
      one_sentence_paragraphs: micDrops,
      has_one_sentence_paragraph: micDrops > 0,
      has_long_paragraph: paras.some((p) => sentences(p).length >= 4),
      banned_lexical_found: problems.filter((p) => p.gate === "banned-lexical").length,
      banned_templates_found: hits.length,
      numbers_without_source: numbersWithoutSource,
      humor_lines: humor,
      rejections: problems.length,
    },
    null,
    2
  ) + "\n"
);
const review = [
  `# Review mecânico — ${SLUG} (${today})`,
  "",
  `**${problems.length ? "REPROVADO" : "APROVADO PARA PUBLICAÇÃO"}** — ${problems.length} reprovações, ${notes.length} observações.`,
  `Medido no texto: ${words(text).length} palavras · ${paras.length} parágrafos · frase mais curta ${shortest} · mais longa ${longest} · ${micDrops} parágrafo(s) de uma frase.`,
  "",
  problems.length ? "## Reprovações\n" + problems.map((p) => `- **${p.gate}** — ${p.msg}`).join("\n") : "## Reprovações\n\nNenhuma.",
  "",
  notes.length ? "## Observações\n" + notes.map((n) => `- ${n.gate}: ${n.msg}`).join("\n") : "",
  "",
  problems.length ? "Corrija o draft.json e rode de novo. O publish.js não roda com reprovação aberta." : "Próximo passo: `node tools/publish.js " + SLUG + "`.",
].join("\n");
fs.writeFileSync(path.join(DIR, "review.md"), review);

console.log(problems.length ? `REPROVADO · ${problems.length} reprovações` : "APROVADO PARA PUBLICAÇÃO");
for (const p of problems) console.log(`  ✗ [${p.gate}] ${p.msg}`);
for (const n of notes.slice(0, 8)) console.log(`  · [${n.gate}] ${n.msg}`);
console.log(`review: pipeline/drafts/${SLUG}/review.md`);
process.exit(problems.length ? 1 : 0);
});
