/* pick-lead.js — escolhe a próxima pauta sem interação humana.
   Imprime uma linha JSON {url, pillar, topic, slug} da melhor pauta do dia que
   ainda não tenha rascunho; exit 1 quando não há nenhuma (a rodada só coleta).

   A fila é lida com três memórias, porque as três falham juntas:
   · fonte já publicada (js/articles-db.js) — a mesma notícia não pode subir
     duas vezes, e o título da fonte citada também não, porque coluna recorrente
     sai toda semana com URL nova;
   · pipeline/memory.json — o que as rodadas anteriores já tentaram e com que
     resultado, já que rascunho e estado local são gitignored e o runner do
     Actions nasce limpo todo turno;
   · idade da fonte — uma pauta de 24 dias não é notícia, e era isso que o robô
     publicava quando o score vinha de palavra-chave e não de frescor.

   Uso: node tools/pick-lead.js                                              */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LEADS = path.join(ROOT, "pipeline", "leads");
const DRAFTS = path.join(ROOT, "pipeline", "drafts");
const mem = require("./lib/memory");
const { idadeEmDias } = require("./lib/feeddate");

const cadencia = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "cadence.json"), "utf8"));
  } catch {
    return {};
  }
})();
const MAX_IDADE_DIAS = Number(cadencia.lead_max_age_days ?? 7);
const RETENTATIVA = cadencia.lead_retry_hours || {};

const slugify = (s) =>
  String(s).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

global.window = {};
require(path.join(ROOT, "js", "articles-db.js"));
const DB = global.window.HWP_DATABASE;
const publicados = new Set([...DB.articles, ...DB.reviews].map((a) => a.id));
const fontesUsadas = mem.fontesPublicadas(DB);
const colunasJaCobertas = mem.titulosFontesPublicadas(DB);
const tentadas = mem.ler(ROOT).leads;

const tomadas = new Set();
if (fs.existsSync(DRAFTS)) {
  for (const d of fs.readdirSync(DRAFTS)) {
    tomadas.add(d);
    try { tomadas.add(slugify(JSON.parse(fs.readFileSync(path.join(DRAFTS, d, "brief.json"), "utf8")).topic || "")); } catch {}
  }
}

const files = fs.existsSync(LEADS) ? fs.readdirSync(LEADS).filter((f) => f.endsWith(".json")).sort().reverse() : [];
const candidatas = [];
const porQue = { fonte_ja_usada: 0, coluna_ja_coberta: 0, ja_tentada: 0, pauta_velha: 0, rascunho_ou_id: 0 };
for (const f of files.slice(0, 3)) {
  const j = JSON.parse(fs.readFileSync(path.join(LEADS, f), "utf8"));
  const leads = (j.leads || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  for (const l of leads) {
    const slug = slugify(l.title);
    const chave = mem.urlChave(l.url);
    if (tomadas.has(slug) || publicados.has(slug)) {
      porQue.rascunho_ou_id++;
      continue;
    }
    if (fontesUsadas.has(chave)) {
      porQue.fonte_ja_usada++;
      console.error(`pauta descartada (fonte já está numa matéria publicada): ${l.url}`);
      continue;
    }
    /* Coluna que sai toda semana com URL nova: a fonte repetida não pega, mas o
       título da fonte citada na matéria que já está no ar é o mesmo. */
    if (colunasJaCobertas.has(mem.tituloChave(l.title))) {
      porQue.coluna_ja_coberta++;
      console.error(`pauta descartada (coluna recorrente já coberta por outra matéria): ${l.title}`);
      continue;
    }
    if (mem.bloqueada(tentadas[chave], RETENTATIVA)) {
      porQue.ja_tentada++;
      console.error(`pauta descartada (já tentada há pouco: ${tentadas[chave].outcome}): ${l.url}`);
      continue;
    }
    /* Fonte sem data legível não é descartada: feed quebrado não pode virar
       censura. Com data velha, a pauta sai da fila sozinha. */
    const idade = idadeEmDias(l.published);
    if (idade !== null && idade > MAX_IDADE_DIAS) {
      porQue.pauta_velha++;
      continue;
    }
    candidatas.push({ url: l.url, pillar: l.pillar, topic: l.title, slug, source: l.source, score: l.score, published: l.published || null, idade_fonte: idade, file: f });
  }
}

/* Feed quebrado é comum (a ScienceDaily já entregou item com 404). A fonte é
   checada aqui, antes de gastar chave: o editor reprova link morto, e a rodada
   inteira se perderia depois do texto pronto. */
async function alcançavel(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HomeworldPressBot/1.0; curadoria local)" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

(async () => {
  /* Todas as candidatas são sondadas, não só as oito primeiras: se as topo de
     fila são de um portal que bloqueia robô (403), o oitavo lugar nunca seria
     oferecido e a rodada fecharia verde "sem pauta nova". O teto de tempo existe
     porque cada sonda pode demorar 10s e a rodada tem relógio. */
  const orcamentoMs = 120000;
  const t0 = Date.now();
  let sondadas = 0;
  let naoAbre = 0;
  for (const c of candidatas) {
    if (sondadas >= 8 && Date.now() - t0 > orcamentoMs) {
      console.error(`pick-lead: teto de tempo da sondagem estourado (${sondadas} de ${candidatas.length} fontes checadas)`);
      break;
    }
    sondadas++;
    if (!(await alcançavel(c.url))) {
      console.error(`pauta descartada (fonte não abre): ${c.url}`);
      naoAbre++;
      mem.registrar(ROOT, c.url, "fonte_inalcancavel", { slug: c.slug, topic: c.topic });
      continue;
    }
    /* A partir daqui a pauta está comprometida com esta rodada: se o registro
       não for escrito, um turno que morre no meio volta nela para sempre. */
    mem.registrar(ROOT, c.url, "em_andamento", { slug: c.slug, topic: c.topic });
    console.log(JSON.stringify(c));
    process.exit(0);
  }
  const total = candidatas.length + Object.values(porQue).reduce((a, b) => a + b, 0);
  console.error(
    `nenhuma pauta nova hoje (${total} itens nas 3 filas mais recentes: ${porQue.fonte_ja_usada} com fonte já publicada, ` +
      `${porQue.coluna_ja_coberta} de coluna já coberta, ${porQue.ja_tentada} tentadas há pouco, ${porQue.pauta_velha} com fonte velha, ${porQue.rascunho_ou_id} com rascunho/id no ar` +
      `${naoAbre ? `, ${naoAbre} com fonte que não abriu (fora da fila 12h)` : ""}) — ` +
      "a rodada termina após coletar e checar"
  );
  process.exit(1);
})();
