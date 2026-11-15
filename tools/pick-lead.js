/* pick-lead.js — escolhe a próxima pauta sem interação humana.
   Imprime uma linha JSON {url, pillar, topic, slug} da melhor pauta do dia que
   ainda não tenha rascunho; exit 1 quando não há nenhuma (a rodada só coleta);
   exit 2 quando NENHUMA sonda recebeu resposta HTTP — falta de rede aqui ou
   fonte que aceita a conexão e não responde dentro de 10s. Aí nenhuma pauta é
   marcada, porque a varredura inteira falha para o mesmo transporte e 12h de
   fila boa iriam embora sem evidência de que a fonte existe. A rodada fecha
   vermelha nesse caso, para a mão de reserva refazê-la.
   Uso: node tools/pick-lead.js          (COMPROMETE a pauta: em_andamento, 6h fora da fila)
        node tools/pick-lead.js --dry    (a mesma escolha, nenhuma escrita)

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
const transporte = require("./lib/transporte");
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

/* O diretório de rascunho é a trava de "a rodada está trabalhando nisto", não
   uma sentença. Quem diz se ainda está trabalhando é a mesma régua usada
   abaixo — `lead_retry_hours` através de `mem.bloqueada()` —, porque `drafts/`
   é gitignored e sobrevive ao `git clean -fdq` (sem `-x`) do runner: uma vez
   criado, o diretório prendia a pauta para sempre. Medido em 15/11 nos dados
   reais: 3 de 3 registros `falha_texto` e 2 de 4 `reprovada` tinham o
   diretório no disco, e a promessa do `cadence.json` ("volta à fila em 24h",
   o motivo de a morte do redator ter saído de 72h para 24h) não chegava a
   valer — `rascunho_ou_id` descartava a candidata em cada rodada seguinte, e
   cada redator que morria reduzia em uma o suprimento do dia. Sem registro na
   memória a trava continua valendo: pode ser rascunho do dono, e cardápio
   velho não é motivo para escrever por cima do trabalho de alguém.           */
const tomadas = new Set();
const tentandoAinda = new Set();
const tentadasComSlug = new Set();
for (const r of Object.values(tentadas)) {
  if (!r || !r.slug) continue;
  tentadasComSlug.add(r.slug);
  if (mem.bloqueada(r, RETENTATIVA)) tentandoAinda.add(r.slug);
}
let liberados = 0;
if (fs.existsSync(DRAFTS)) {
  for (const d of fs.readdirSync(DRAFTS)) {
    if (tentadasComSlug.has(d) && !tentandoAinda.has(d)) {
      liberados++;
      continue;
    }
    tomadas.add(d);
    try { tomadas.add(slugify(JSON.parse(fs.readFileSync(path.join(DRAFTS, d, "brief.json"), "utf8")).topic || "")); } catch {}
  }
}
if (liberados) console.error(`pick-lead: ${liberados} rascunho(s) de tentativa já vencida liberado(s) da trava (a janela de retry venceu; o diretório continua no disco)`);

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
   inteira se perderia depois do texto pronto.
   Quatro vereditos, porque "a fonte não abre", "esta máquina está sem rede" e
   "a conexão empacou" são três fatos diferentes com pesos diferentes:
   · `nao-abre` é o único que merece tirada de fila (houve resposta HTTP, a
     fonte existe e está devolvendo erro — 12h fora);
   · `sem-rede` é falha de transporte local (ENOTFOUND, ECONNREFUSED, …);
   · `empacou` é conexão que não devolve NENHUMA resposta dentro dos 10 s do
     AbortSignal — host grudado, proxy cativo, porta fechada no meio do caminho.
   Os dois últimos não marcam nada: cada um pode derrubar a lista inteira em
   segundos, e enterrar 8 pautas sãs por 12h por um link ruim é perder
   suprimento pela porta do transporte. Medido com servidor que aceita e cala:
   o `sinal` fica `TimeoutError 23 The operation was aborted due to timeout`,
   nenhum token do regex antigo casa (o `code` é o NÚMERO 23, não uma string) e
   o veredito caía em `nao-abre` — a digital do AbortSignal são as gravações
   exatamente 10 s apartes, e a varredura saía 1 (fila vazia) em vez de 2. */
async function sonda(url) {
  /* Boca de prova: `HWP_SONDA=abre` faz toda fonte abrir. Sem ela, uma prova
     que exercita a SELEÇÃO fica refém do DNS — `fixture.example` não resolve, e
     o loop morria na primeira sonda sem nunca chegar à trava que está sendo
     conferida. Não há valor que invente fonte: o default é sonda de verdade. */
  if ((process.env.HWP_SONDA || "") === "abre") return "abre";
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HomeworldPressBot/1.0; curadoria local)" },
    });
    return res.ok ? "abre" : "nao-abre";
  } catch (e) {
    /* A leitura dos tokens mora em `lib/transporte.js` — a MESMA boca que decide
       se o `write.js` espera um provedor ocupado ou pula um que recusa a
       conexão. Duas listas paralelas de tokens é o defeito que esta doc nomeia:
       foi ela que deixou o `TimeoutError` do AbortSignal cair em `nao-abre` e
       enterrar a fila inteira por 12h. */
    const v = transporte.classe(e);
    return v === "outra" ? "nao-abre" : v;
  }
}

(async () => {
  /* Todas as candidatas são sondadas, não só as oito primeiras: se as topo de
     fila são de um portal que bloqueia robô (403), o oitavo lugar nunca seria
     oferecido e a rodada fecharia verde "sem pauta nova". O teto de tempo existe
     porque cada sonda pode demorar 10s e a rodada tem relógio. */
  const orcamentoMs = 120000;
  const t0 = Date.now();
  /* `--dry` é a olhada sem preço: a partir do registro abaixo a pauta fica
     6h fora da fila (`em_andamento`), e uma fonte que não abre sai por 12h —
     quem roda isto à mão para ver o que a próxima rodada pegaria pagava por
     olhar. A seleção é a mesma, só nenhuma escrita acontece. */
  const SECO = process.argv.includes("--dry");
  let sondadas = 0;
  let naoAbre = 0;
  let semRede = 0;
  let empacou = 0;
  for (const c of candidatas) {
    if (sondadas >= 8 && Date.now() - t0 > orcamentoMs) {
      console.error(`pick-lead: teto de tempo da sondagem estourado (${sondadas} de ${candidatas.length} fontes checadas)`);
      break;
    }
    sondadas++;
    const veredito = await sonda(c.url);
    if (veredito === "sem-rede") {
      /* Nada é marcado aqui, e o loop continua: a lista inteira sendo varrida
         com o mesmo sintoma é o que decide, no fim, que o defeito é daqui. */
      console.error(`pauta não sondada (sem rede nesta máquina): ${c.url}`);
      semRede++;
      continue;
    }
    if (veredito === "empacou") {
      /* Mesma regra do `sem-rede`: sem resposta HTTP não há evidência nenhuma de
         que a fonte esteja morta, só de que ela não respondeu em 10s — e um
         portal lento não pode custar 12h de fila a uma pauta que a rodada ainda
         pode pegar no próximo horário. */
      console.error(`pauta não sondada (nenhuma resposta em 10s): ${c.url}`);
      empacou++;
      continue;
    }
    if (veredito === "nao-abre") {
      console.error(`pauta descartada (fonte não abre): ${c.url}`);
      naoAbre++;
      if (!SECO) mem.registrar(ROOT, c.url, "fonte_inalcancavel", { slug: c.slug, topic: c.topic });
      continue;
    }
    /* A partir daqui a pauta está comprometida com esta rodada: se o registro
       não for escrito, um turno que morre no meio volta nela para sempre. */
    if (!SECO) mem.registrar(ROOT, c.url, "em_andamento", { slug: c.slug, topic: c.topic });
    if (SECO) console.error("pick-lead --dry: nada registrado — a fila está intacta");
    console.log(JSON.stringify(c));
    process.exit(0);
  }
  const total = candidatas.length + Object.values(porQue).reduce((a, b) => a + b, 0);
  console.error(
    `nenhuma pauta nova hoje (${total} itens nas 3 filas mais recentes: ${porQue.fonte_ja_usada} com fonte já publicada, ` +
      `${porQue.coluna_ja_coberta} de coluna já coberta, ${porQue.ja_tentada} tentadas há pouco, ${porQue.pauta_velha} com fonte velha, ${porQue.rascunho_ou_id} com rascunho/id no ar` +
      `${naoAbre ? `, ${naoAbre} com fonte que não abriu (fora da fila 12h)` : ""}` +
      `${semRede ? `, ${semRede} não sondadas por falta de rede (nada marcado)` : ""}` +
      `${empacou ? `, ${empacou} sem nenhuma resposta em 10s (nada marcado)` : ""}) — ` +
      "a rodada termina após coletar e checar"
  );
  /* Se NADA chegou a uma resposta HTTP e o sintoma foi sempre falha de
     transporte, o defeito é desta máquina, não das fontes: sair 1 diria "sem
     pauta nova" numa fila que só está hígida e invisível por um link caído, e
     marcar cada URL teria enterrado a fila inteira por 12h. A varredura
     completa é o que distingue os dois — fonte morta dá HTTP, máquina sem link
     dá ENOTFOUND/ECONNREFUSED em todas, host grudado dá timeout. Uma resposta
     HTTP em qualquer candidata já prova que o link existe, então aí `nao-abre`
     continua valendo fila vazia (exit 1). */
  if (!naoAbre && (semRede || empacou)) {
    console.error("pick-lead: nenhuma sonda recebeu resposta HTTP — nenhuma pauta foi marcada, a fila está intacta (exit 2)");
    process.exit(2);
  }
  process.exit(1);
})();
