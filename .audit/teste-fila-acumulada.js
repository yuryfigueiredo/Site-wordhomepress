/* teste-fila-acumulada.js — prova de que a fila do dia ACUMULA e não é reescrita.

   O defeito é um par que só se vê juntos: o `seen.add` marca toda URL que entrou
   na fila (é o que impede a recoleta) e o `writeFileSync` de cima jogava o
   arquivo do dia fora a cada rodada. Medido em 14/11 nos arquivos desta máquina:
   11-13.json e 11-14.json têm 1 pauta cada (dias de 4 rodadas), 11-11 tem 19 (dia
   em que a última ingestão foi a primeira). Como o pick-lead lê as 3 filas mais
   recentes, a cola onde a memória do dia sobrevivia — o arquivo — era justamente
   a peça destruída: visto = perdido. O teto de 5 peças/dia nasce daqui, não do
   relógio.

   A prova roda `node tools/ingest.js` duas vezes contra uma cópia do repo no
   /tmp, com os feeds servidos por um http local — a boca HWP_FEEDS_JSON/
   HWP_LEAD_DIR/HWP_SEEN_FILE é a mesma convenção do HWP_REPO/HWP_STATE do
   hwp-turno.sh e existe pelo mesmo motivo: sem ela isto só poderia ser conferido
   gravando no seen.json real. Entre as duas rodadas o feed ganha UM item novo,
   que é exatamente a situação da rodada seguinte dentro do mesmo dia. Depois vem
   a falsificação: o mesmo fixture com o ingest costurado de volta para "escreve
   só a lista desta rodada" tem de desabar em 1 pauta, senão as asserções de cima
   não medem nada.                                                            */
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { execFileSync, execFile } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const fixtures = [];
let verde = 0;
const falhas = [];
function confere(nome, ok, dado) {
  if (ok) {
    verde++;
    console.log(`  ✓ ${nome}`);
  } else {
    falhas.push(nome);
    console.log(`  ✗ ${nome}${dado === undefined ? "" : " :: " + String(dado).slice(0, 300)}`);
  }
}

const sha = (b) => crypto.createHash("sha256").update(Buffer.isBuffer(b) ? b : fs.readFileSync(b)).digest("hex");

/* ── os RSS fixos ────────────────────────────────────────────────────────
   Quatro itens por feed passa dos dois tetos que derrubariam a prova: o
   PER_SOURCE_CAP (8 por fonte) e o LIMIT (60 no total) — somando 8 por fonte o
   arquivo acumulado seria cortado e "N + 1" nunca apareceria. Os títulos levam
   termos suficientes para pontuar ≥2 no pilar (abaixo disso o próprio ingest
   descarta a pauta).

   As duas fontes têm nomes de pilar diferentes ("Proveniência Astronômica" /
   "Observatório Local") porque a capitulação é por NOMES de fonte, não pela
   lista de pilares do feed: com o mesmo nome as duas listas colidem no mapa de
   KEYWORDS e a segunda entrega só é pontuada contra o primeiro pilar — medida
   na primeira corrida desta prova, os 4 itens do segundo feed sumiam da fila
   sem nenhum erro.

   Os títulos das duas listas se sobrepõem de propósito (mesmo assunto, outra
   URL): é assim que a fusão exercita o teto de sobreposição em vez de só
   empilhar cards idênticos, e é por isso que as contas abaixo são 4 e 5, não 8
   e 10. O feed B é o pilar tech com itens de vocabulário misto — dois deles
   batem só em "science", ficam `fit: secundário` e dão ao sort do merged as
   duas classes que ele precisa ordenar; com um único valor de fit a asserção
   da ordem seria vazia.                                                       */
const DIA = new Date().toISOString().slice(0, 10);
const AGORA_RSS = () => new Date().toUTCString();
const FEEDS_FIXOS = [
  ["lunar", "A telescope mission to the lunar surface maps ice in a permanent orbit", "The probe will study the moon's south pole with a radio instrument and an atomic clock."],
  ["europa", "Europa ocean research gets a new mission profile from scientists at the observatory", "A cryobot and a relay probe would sample the atmosphere above the ice shell."],
  ["quantum", "A quantum memory built for an optical display reaches record fidelity on the screen", "The hardware of the atomic clock link was tested across the laboratory's two sensors."],
  ["relatividade", "Relativity test with a probe near the solar corona returns its first data", "The mission measures how light from a distant observatory bends around the sun."],
];
const NOVO = ["exoplaneta", "An exoplanet survey by the telescope array finds a super-Earth in orbit", "The astronomers used spectroscopy on the planet's atmosphere to look for a biosignature."];
const NOVO_B = ["orbita", "The telescope mission to the lunar surface maps ice in a permanent orbit twice", "The probe will study the moon's south pole with a radio instrument and an atomic clock."];

let PORT = 0;
let rodadaNovaItem = false;
let servidor = null;
let buscas = 0;

function rssDoFeed(letra) {
  const extras = rodadaNovaItem ? (letra === "a" ? [NOVO] : [NOVO_B]) : [];
  const itens = FEEDS_FIXOS.concat(extras);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n` +
    itens
      .map(
        ([id, title, desc]) =>
          `    <item>\n      <title>${title}</title>\n      <link>http://proveniencia.local/${letra}/fonte/${id}</link>\n      <description>${desc}</description>\n      <pubDate>${AGORA_RSS()}</pubDate>\n    </item>`,
      )
      .join("\n") +
    `\n  </channel>\n</rss>\n`
  );
}

function serveFeed(req, res) {
  buscas++;
  const letra = req.url.startsWith("/feed/a") ? "a" : req.url.startsWith("/feed/b") ? "b" : null;
  if (!letra) {
    res.writeHead(404);
    res.end();
    return;
  }
  /* Sem Content-Length nenhum: o ingest faz `global.window = {}` antes de
     require('js/articles-db.js') para ler DB como navegador, e enquanto esse
     global existe o Node acha que está num browser e descarta o cabeçalho — a
     resposta sai em chunked e o cliente espera o corpo inteiro até estourar os
     20s do AbortSignal. Medido na primeira corrida desta prova: 0 pautas com o
     feed no ar.                                                              */
  res.writeHead(200, { "Content-Type": "application/rss+xml" });
  res.end(rssDoFeed(letra));
}

/* ── a fixture: cópia do repo + boca de teste ────────────────────────────── */
function copia() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwp-fila-"));
  fixtures.push(dir);
  /* o "/." é o que copia o CONTEÚDO: sem ele o cp leva a pasta para dentro da
     fixture e o tools/ingest.js não existe no caminho que a fixture lê.       */
  execFileSync("cp", ["-a", `${ROOT}/.`, `${dir}/`], { stdio: "ignore" });
  /* pipeline/leads/ e state/ são gitignored e vivem nesta máquina: a fixture
     começa vazia para que a conta de pautas seja mérito do ingest, e não
     herança do seen real.                                                     */
  fs.rmSync(path.join(dir, "pipeline", "leads"), { recursive: true, force: true });
  fs.rmSync(path.join(dir, "pipeline", "state", "seen.json"), { force: true });
  return dir;
}

/* execFile e não execFileSync: com o servidor HTTP no MESMO processo desta
   prova, o filho do execFileSync recebe a requisição mas nunca vê a resposta
   — o evento não é despachado enquanto o pai está bloqueado — e o fetch do
   ingest morre nos 20s do AbortSignal com 0 pautas coletadas. Assíncrono o
   loop vive e a coleta sai em ~1s. Provado porta a porta nesta máquina:
   porta aberta dá timeout no síncrono e ECONNREFUSED no assíncrono.          */
function rodaIngest(dir) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(dir, "tools", "ingest.js")],
      {
        cwd: dir,
        encoding: "utf8",
        timeout: 120000,
        env: {
          ...process.env,
          HWP_FEEDS_JSON: JSON.stringify([
            { url: `http://127.0.0.1:${PORT}/feed/a`, source: "Proveniência Astronômica", pillars: ["science"] },
            { url: `http://127.0.0.1:${PORT}/feed/b`, source: "Observatório Local", pillars: ["tech"] },
          ]),
          HWP_LEAD_DIR: path.join(dir, "pipeline", "leads"),
          HWP_SEEN_FILE: path.join(dir, "pipeline", "state", "seen.json"),
        },
      },
      (err, stdout, stderr) => {
        const jsonPath = path.join(dir, "pipeline", "leads", `${DIA}.json`);
        const mdPath = path.join(dir, "pipeline", "leads", `${DIA}.md`);
        const seenPath = path.join(dir, "pipeline", "state", "seen.json");
        resolve({
          code: err ? (err.code === undefined ? -1 : err.code) : 0,
          saida: `${stdout || ""}${stderr || ""}`,
          fila: fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, "utf8")) : null,
          md: fs.existsSync(mdPath) ? fs.readFileSync(mdPath, "utf8") : "",
          vistos: fs.existsSync(seenPath) ? JSON.parse(fs.readFileSync(seenPath, "utf8")).urls : [],
        });
      },
    );
  });
}

(async () => {
  servidor = http.createServer(serveFeed);
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  PORT = servidor.address().port;

  /* O estado real da máquina antes de tudo: a prova morre se mexer aqui. */
  const reaisAntes = new Map();
  for (const f of fs.readdirSync(path.join(ROOT, "pipeline", "leads")).filter((x) => x.endsWith(".json")).sort()) {
    reaisAntes.set(`pipeline/leads/${f}`, sha(path.join(ROOT, "pipeline", "leads", f)));
  }
  reaisAntes.set("pipeline/state/seen.json", sha(path.join(ROOT, "pipeline", "state", "seen.json")));

  console.log("1. a segunda rodada do dia encontra a fila da primeira intacta");
  const dir = copia();
  const r1 = await rodaIngest(dir);
  confere("rodada 1 saiu 0", r1.code === 0, r1.saida.slice(0, 200));
  const n = (r1.fila?.leads || []).length;
  confere("rodada 1 escreveu as 4 pautas dos dois feeds (os pares repetidos caem na sobreposição de título)", n === 4, `foram ${n} · ${(r1.fila?.leads || []).map((l) => l.title).join(" | ")}`);
  confere("rodada 1 se declarou como primeira do dia (rodadas: 1)", r1.fila?.rodadas === 1, `rodadas = ${r1.fila?.rodadas}`);
  confere("rodada 1 registrou primeira_coleta igual a generated", r1.fila?.primeira_coleta === r1.fila?.generated, `${r1.fila?.primeira_coleta} ≠ ${r1.fila?.generated}`);
  confere("rodada 1 marcou as 4 URLs da fila como vistas", r1.vistos.length === 4, `visto ${r1.vistos.length}`);
  const urls1 = r1.fila.leads.map((l) => l.url).sort();

  /* a única coisa que muda entre as duas rodadas do cron é o feed ganhar um item */
  rodadaNovaItem = true;
  const r2 = await rodaIngest(dir);
  confere("rodada 2 saiu 0", r2.code === 0, r2.saida.slice(0, 200));
  const fila2 = r2.fila?.leads || [];
  confere("rodada 2 NÃO apagou a fila: ainda estão as 4 da rodada 1", urls1.every((u) => fila2.some((l) => l.url === u)), `ficaram ${fila2.length}: ${fila2.map((l) => l.url).join(", ")}`);
  confere("rodada 2 acrescentou a pauta nova (5 no total)", fila2.length === 5, `foram ${fila2.length}`);
  confere("nenhuma URL repetida na fila acumulada", new Set(fila2.map((l) => l.url)).size === fila2.length, fila2.map((l) => l.url).join(", "));
  confere("o contador de rodadas chegou a 2", r2.fila?.rodadas === 2, `rodadas = ${r2.fila?.rodadas}`);
  confere("count bate com o tamanho do array (quem lê o arquivo não pode contar cego)", r2.fila?.count === fila2.length, `count=${r2.fila?.count} × array=${fila2.length}`);
  confere("generated é desta coleta e primeira_coleta continua a da primeira", r2.fila?.generated !== r2.fila?.primeira_coleta && r2.fila?.primeira_coleta === r1.fila?.generated, `${r2.fila?.primeira_coleta} → ${r2.fila?.generated}`);
  confere("feeds_ok reflete esta corrida (2 de 2)", r2.fila?.feeds_ok === 2, `feeds_ok = ${r2.fila?.feeds_ok}`);

  console.log("\n2. o card preservado pela fusão tem os campos de sempre");
  {
    /* A fusão tem de devolver o card do arquivo com os campos originais dele:
       um item velho não tem `keywords` na memória desta rodada, e a linha de
       termos do .md leria undefined. É o mesmo shape que o ingest sempre
       produziu, campo por campo.                                              */
    const CAMPOS = ["url", "title", "source", "feed_pillars", "pillar", "register", "score", "keywords", "fit", "summary", "published"].slice().sort();
    confere("nenhum item da fila perdeu campo na fusão", fila2.every((l) => JSON.stringify(Object.keys(l).sort()) === JSON.stringify(CAMPOS)), fila2.filter((l) => JSON.stringify(Object.keys(l).sort()) !== JSON.stringify(CAMPOS)).map((l) => `${l.url}: ${Object.keys(l).join(",")}`).join(" | "));
    const velho = fila2.find((l) => l.url === urls1[0]);
    const novo = fila2.find((l) => l.url === "http://proveniencia.local/a/fonte/exoplaneta");
    confere("a pauta da rodada anterior atravessou a fusão com os mesmos campos", velho && JSON.stringify(Object.keys(velho).sort()) === JSON.stringify(CAMPOS), velho && Object.keys(velho).join(","));
    confere("a pauta nova tem os mesmos campos da antiga", novo && JSON.stringify(Object.keys(novo).sort()) === JSON.stringify(CAMPOS), novo && Object.keys(novo).join(","));
    const peso = (l) => `${l.fit === "direto" ? 1 : 0}:${String(l.score).padStart(3, "0")}`;
    confere("o sort que o código já usa continua valendo no merged (fit direto primeiro, score decrescente)", (() => {
      for (let i = 1; i < fila2.length; i++) if (peso(fila2[i]) > peso(fila2[i - 1])) return false;
      return true;
    })(), fila2.map((l) => `${l.fit}/${l.score}`).join(" "));
    confere("há fit direto e secundário na fila, senão o sort acima seria vazio", new Set(fila2.map((l) => l.fit)).size === 2, fila2.map((l) => `${l.source}:${l.fit}`).join(","));
  }

  console.log("\n3. o .md é a fila acumulada, não a última coleta");
  {
    /* O regex tolera \r: com core.autocrlf=input a árvore de trabalho tem CRLF
       e um portão que lê arquivo do disco sem aguentar o retorno já foi defeito
       deste repo uma vez. A linha é pega por [^\n], não por (.*): com $ no fim,
       o lazy da outra forma come os próprios \n\n e devolve vazio — confere
       abaixo que a linha veio mesmo, senão isto seria verde mentiroso.        */
    const cabecalho = (r2.md.match(/^# Fila[^\n]*\n\n([^\n]+)/) || [, ""])[1];
    confere("a linha do cabeçalho foi lida (sem ela os dois conferes de baixo seriam vazios)", cabecalho.length > 10, cabecalho);
    confere("o .md diz que é a fila acumulada do dia e quantas rodadas a produziram", /acumulad/.test(cabecalho) && /2 rodada/.test(cabecalho), cabecalho);
    confere("o número do cabeçalho bate com o JSON", cabecalho.includes(`${fila2.length} pautas`), cabecalho);
    confere("todas as 5 URLs acumuladas aparecem no .md", fila2.every((l) => r2.md.includes(l.url)), "o .md ficou na última rodada");
    confere("o stdout do ingest conta a fila acumulada (é a linha que o TURNO.md mostra)", /fila: 5 pautas acumuladas em 2 rodada/.test(r2.saida), r2.saida.split("\n").find((l) => l.startsWith("fila:")));
  }

  console.log("\n4. visto = coletado uma vez, mas nunca perdido da fila");
  {
    const esperado = [...urls1, "http://proveniencia.local/a/fonte/exoplaneta"].sort();
    confere("o seen da fixture tem as 5 URLs das duas rodadas", JSON.stringify(r2.vistos.slice().sort()) === JSON.stringify(esperado), `visto ${r2.vistos.length}: ${r2.vistos.join(", ")}`);
    confere("e a fila tem as mesmas 5 — o par que estava quebrado", fila2.length === r2.vistos.length && esperado.every((u) => fila2.some((l) => l.url === u)), `fila ${fila2.length} × visto ${r2.vistos.length}`);
    const r3 = await rodaIngest(dir);
    confere("rodada 3 sem nada novo no feed mantém as 5 (nada recoletável, nada perdido)", r3.fila?.leads?.length === 5 && r3.fila?.rodadas === 3, `ficaram ${r3.fila?.leads?.length} em ${r3.fila?.rodadas} rodada(s)`);
  }

  console.log("\n5. a visão do pick-lead sobre a fixture não está faminta");
  {
    /* A leitura é a mesma do tools/pick-lead.js: as 3 filas mais recentes do
       diretório, achatadas — o slice(0, 3) que fazia o arquivo de 1 pauta virar
       a única ração do dia. Não se roda o pick-lead aqui por dois motivos: ele
       sonda cada URL com fetch e gastaria até 120s nisso (em proveniência de
       fixture nenhuma abriria, e a conta sairia vermelha por um motivo que não é
       este teste), e o LEADS dele é fixo em pipeline/leads — sem HWP_LEAD_DIR,
       que só o ingest conhece, uma boca armada na prova faria o pick-lead ler a
       fila REAL desta máquina. --dry não basta para isso: seco é não escrever,
       não é não ler.                                                          */
    const LEADS = path.join(dir, "pipeline", "leads");
    const tres = fs.readdirSync(LEADS).filter((f) => f.endsWith(".json")).sort().reverse().slice(0, 3);
    const candidatas = tres.flatMap((f) => JSON.parse(fs.readFileSync(path.join(LEADS, f), "utf8")).leads || []).length;
    confere("as 3 filas mais recentes da fixture dão mais de 1 candidata", candidatas > 1, `${tres.join(", ")} → ${candidatas}`);
    confere("o arquivo fino do defeito (1 pauta) não se repete na fixture", !tres.some((f) => JSON.parse(fs.readFileSync(path.join(LEADS, f), "utf8")).leads.length <= 1), tres.join(", "));
  }

  console.log("\n6. falsificação: costurado de volta para escrever só a rodada, a fila desaba");
  {
    const dirMutada = copia();
    const arq = path.join(dirMutada, "tools", "ingest.js");
    const fonte = fs.readFileSync(arq, "utf8");
    /* A mutação é na ORIGEM da fila, não na chave `leads:` da escrita: esta
       prova já foi verde conferindo um replace que nem o texto do repo tinha
       mais depois. Se a frase mudar de forma, o confere abaixo quebra e é para
       quebrar mesmo — portão provado por mutação que não faz o que diz é pior
       do que não ter portão.                                                 */
    const alvo = "for (const lead of acumuladas.sort";
    const mutada = fonte.replace(alvo, "for (const lead of accepted.sort");
    confere("a mutação encontrou a lista que a fusão acumula", mutada !== fonte && mutada.includes("accepted.sort"), "o texto da fusão mudou de forma — atualize a mutação");
    fs.writeFileSync(arq, mutada);
    rodadaNovaItem = false;
    const m1 = await rodaIngest(dirMutada);
    rodadaNovaItem = true;
    const m2 = await rodaIngest(dirMutada);
    confere("com o merge arrancado a rodada 1 ainda escreve as 4", m1.fila?.leads?.length === 4, `foram ${m1.fila?.leads?.length}`);
    /* A régua do defeito no disco, medida em 14/11: 11-13.json e 11-14.json têm
       exatamente 1 pauta cada. Aqui a rodada mutada escreve as 5 pautas que a
       última coleta achou — o número não é o do disco porque o feed B é outra
       fonte e não herda o cap do A. O que morde é o par: as 4 da primeira
       rodada somem do arquivo e continuam todas marcadas como vistas. Visto
       sem fila é perda pura, e é ela que deixa a fila do dia em 1 pauta.     */
    const sobraramDaRodada1 = (m2.fila?.leads || []).filter((l) => urls1.includes(l.url)).length;
    confere("a rodada 2 mutada perde as 4 pautas da rodada 1 (fica com só o que esta coleta achou)", m2.fila?.leads?.length === 5 && sobraramDaRodada1 === 0, `ficaram ${(m2.fila?.leads || []).length}, sobreviveram ${sobraramDaRodada1} das 4`);
    confere("e mesmo assim o seen tem as 4 velhas + a nova: visto = perdido", m2.vistos.length >= 5 && urls1.every((u) => m2.vistos.includes(u)), `visto ${m2.vistos.length}`);
    /* Sem a mutação o caso 1 mediria o quê? As duas rodadas acumulam 5 cards e
       nenhum deles se perdeu; aqui são 5 também, mas os 4 da rodada 1 não
       estão mais entre eles. É essa inversão, não o tamanho, que prova que o
       conferido de cima é a fusão.                                            */
    confere("o verde do caso 1 é justamente o que a mutação desfaz: mesmo total, cards diferentes", fila2.length === (m2.fila?.leads || []).length && sobraramDaRodada1 === 0, `${fila2.length} × ${(m2.fila?.leads || []).length} · sobraram ${sobraramDaRodada1}`);
  }

  console.log("\n7. a boca trocada percorre o mesmo caminho, sem implementação paralela");
  {
    /* 11 buscas: 2 feeds × (3 rodadas boas + 2 mutadas) + a sondagem do --show,
       que abre o arquivo pronto e não busca nada. Contar requisições é o que
       prova que quem correu foi o laço de sempre, não um atalho da fixture. */
    confere("os dois feeds foram buscados pelo parseFeed/capitulação de sempre (10 buscas)", buscas === 10, `${buscas} buscas`);
    const fonte = fs.readFileSync(path.join(ROOT, "tools", "ingest.js"), "utf8");
    confere("a lista padrão de fontes continua sendo a de sempre, intocada pela boca", (fonte.match(/\{ url: "https:\/\/www\.publishersweekly\.com\/rss\/feature\.xml"/g) || []).length === 1 && fonte.includes("if (!process.env.HWP_FEEDS_JSON)"));
    confere("não há segunda implementação de coleta ao lado da original", (fonte.match(/async function main/g) || []).length === 1 && (fonte.match(/parseFeed\(await res\.text\(\)\)/g) || []).length === 1, "apareceu um caminho paralelo de fetch");
    const dirBoca = copia();
    const antes = buscas;
    const fora = path.join(dirBoca, "pipeline", "leads", "fora-do-dia.json");
    fs.mkdirSync(path.dirname(fora), { recursive: true });
    fs.writeFileSync(
      fora,
      JSON.stringify({ generated: "2026-01-01T00:00:00.000Z", rodadas: 3, primeira_coleta: "2026-01-01T00:00:00.000Z", feeds_ok: 2, count: 1, leads: [{ url: "https://example.com/so-no-arquivo", title: "Pauta velha que o --show deve imprimir", source: "X", pillar: "science", register: "laboratório", score: 3, keywords: ["nasa"], fit: "direto", summary: "y", published: "" }] }, null, 2),
    );
    const hoje = path.join(dirBoca, "pipeline", "leads", `${DIA}.md`);
    fs.writeFileSync(hoje, "# Fila de pautas — hoje\n\n1 pautas acumuladas em 3 rodada(s) de coleta.\n\n- Pauta velha que o --show deve imprimir: http://proveniencia.local/a/fonte/lunar\n");
    const show = await new Promise((resolve) =>
      execFile(process.execPath, [path.join(dirBoca, "tools", "ingest.js"), "--show"], { cwd: dirBoca, encoding: "utf8", env: { ...process.env, HWP_LEAD_DIR: path.join(dirBoca, "pipeline", "leads") }, timeout: 30000 }, (err, stdout) => resolve(String(stdout))),
    );
    confere("--show com só HWP_LEAD_DIR armada lê a fila daquela boca", show.includes("Pauta velha que o --show deve imprimir"), show.slice(0, 160));
    confere("--show não busca feed nenhum (é olhada, não coleta)", buscas === antes, `${buscas - antes} buscas a mais`);
  }

  /* Os tmpdirs desta prova vivem em $TMPDIR, que nesta máquina é o diretório do
     worker remoto — varrer só /tmp deixaria fixture para trás. E a limpeza vem
     ANTES da invariante: conferir "nenhuma fixture em disco" com as fixtures
     desta corrida ainda no disco é pedir ao teste o verde que ele acabou de
     produzir. */
  const prefixos = ["hwp-fila-", "hwp-runner-", "hwp-pickseco-"];
  const raizes = [...new Set([os.tmpdir(), "/tmp"])].filter((r) => fs.existsSync(r));
  const sobras = raizes.flatMap((r) => fs.readdirSync(r, { withFileTypes: true }).filter((e) => e.isDirectory() && prefixos.some((p) => e.name.startsWith(p))).map((e) => path.join(r, e.name)));
  for (const d of [...new Set([...fixtures, ...sobras])]) {
    fs.rmSync(d, { recursive: true, force: true });
  }

  console.log("\n8. invariante: nem o repo nem a máquina foram tocados pela prova");
  {
    const mexido = [];
    for (const [f, hash] of reaisAntes) if (sha(path.join(ROOT, f)) !== hash) mexido.push(f);
    const extras = fs.readdirSync(path.join(ROOT, "pipeline", "leads")).filter((x) => x.endsWith(".json")).sort().filter((x) => !reaisAntes.has(`pipeline/leads/${x}`));
    confere("todos os pipeline/leads/*.json reais estão byte a byte iguais", mexido.length === 0 && extras.length === 0, `mudaram: ${mexido.join(", ")}${extras.length ? " · novos: " + extras.join(", ") : ""}`);
    confere("o seen.json desta máquina está byte a byte igual", sha(path.join(ROOT, "pipeline", "state", "seen.json")) === reaisAntes.get("pipeline/state/seen.json"));
    confere("nenhuma fixture ficou em disco", fixtures.every((d) => !fs.existsSync(d)), fixtures.filter((d) => fs.existsSync(d)).join(", "));
  }

  servidor.close();
  console.log(`\n${verde} conferências verdes, ${falhas.length} vermelhas${falhas.length ? ": " + falhas.join(" | ") : ""}.`);
  process.exit(falhas.length ? 1 : 0);
})().catch((err) => {
  console.error("a prova quebrou:", err);
  servidor?.close();
  for (const d of fixtures) fs.rmSync(d, { recursive: true, force: true });
  process.exit(1);
});
