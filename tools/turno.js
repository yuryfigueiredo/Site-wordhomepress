/* turno.js — uma rodada completa do robô, idêntica no seu PC e no GitHub Actions.
   Coleta → rotação diária → manutenção → teto diário → pauta → brief → texto
   (provedores de pipeline/providers.json) → capa → editor mecânico (até 3
   tentativas) → nota → publicação. Nunca faz push e nunca faz
   deploy: quem commita/envia é o workflow. Escreve TURNO.md, o relatório que
   substitui o painel quando o seu PC está desligado.

   Uso: node tools/turno.js          (exit 0 mesmo quando a rodada para cedo)
        node tools/turno.js --force-slot  (ignora o portão de idempotência)    */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const log = [];
const say = (stage, msg) => { log.push(`- **${stage}** — ${msg}`); console.log(`[${stage}] ${msg}`); };

/* Saída SEM percorrer a pipeline: só o diário e o exit code. O portão do
   horário duplicado precisa sair por aqui porque uma rodada que não começou não
   tem fotos para desfazer, capa para girar nem prova a cobrar — e o `finish()`
   cobra a troca de capa em toda saída depois da manutenção.                */
const saidaCurta = (why, codigo = 0) => {
  if (why) say("fim", why);
  const head = `# Turno — ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC\n\n`;
  fs.writeFileSync(path.join(ROOT, "TURNO.md"), head + log.join("\n") + "\n");
  process.exit(codigo);
};
/* A troca de CAPA só é cobrada depois da manutenção verde: rodar o build
   completo com erro aberto seria publicar por outro caminho. A rotação diária
   do passo 2 não é capa — é o bloco que o doctor exige pronto para hoje. */
let posManutencao = false;
let publicou = false;

/* Retrato dos diretórios de imagem no INÍCIO da rodada. É aqui, e não no
   publish.js, que a foto precisa ser desfeita: quem baixa o jpg é o
   `garantirFoto()` desta etapa de texto, minutos antes de o publish.js existir
   como processo — o retrato do publish já encontrava o arquivo no disco
   e `limparImagensOrfas()` nunca o pegava. Em rodada verde sem publicação
   (reprovada na terceira tentativa, quase-duplicata, teto) o `git add -A` do
   workflow commiteava e empurrava a foto de uma matéria que nunca saiu.
   Arquivos que já estavam no disco antes da rodada são todos preservados,
   inclusive os que o dono deixou lá sem commitar. */
const IMG_DIRS = ["images/posts", "images/covers"];
const fotosDaRodada = new Set(
  IMG_DIRS.flatMap((d) => {
    try {
      return fs.readdirSync(path.join(ROOT, d)).map((f) => `${d}/${f}`);
    } catch {
      return [];
    }
  }),
);
function desfazerFotosDaRodada() {
  const novas = [];
  for (const d of IMG_DIRS) {
    let arquivos = [];
    try {
      arquivos = fs.readdirSync(path.join(ROOT, d));
    } catch {}
    for (const f of arquivos) if (!fotosDaRodada.has(`${d}/${f}`)) novas.push(path.join(ROOT, d, f));
  }
  for (const p of novas) {
    try {
      fs.rmSync(p, { force: true });
    } catch {}
  }
  if (novas.length) say("fotos", `${novas.length} arquivo(s) descartado(s): foto baixada para uma matéria que não chegou ao ar`);
}

/* Rede para a saída que NÃO passa pelo finish: um throw sem catch (um
   `JSON.parse` de arquivo que o provedor devolveu truncado, um `writeFileSync`
   que estoura) derruba a rodada direto, sem desfazer a foto nem escrever
   TURNO.md. No runner o `git clean -fdq` da rodada vermelha encobre isso; na
   máquina do dono, a rodada crashada deixava o jpg de uma matéria que não
   existe. O finish já limpou e `publicou` é a trava de sempre: depois de
   publicar, nada é apagado. */
process.on("exit", (code) => {
  if (code !== 0 && !publicou) desfazerFotosDaRodada();
});

function run(script, args = []) {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, "tools", script), ...args], { cwd: ROOT, stdio: "pipe", timeout: 900000 }).toString();
    return { code: 0, out };
  } catch (err) {
    return { code: err.status || 1, out: String(err.stdout || "") + String(err.stderr || "") };
  }
}
const finish = (why, codigo = 0) => {
  /* Nada publicado = nenhuma foto devida. Desfaz-se primeiro, para o build da
     capa não encontrar um jpg de matéria que não está no catálogo. */
  if (!publicou) desfazerFotosDaRodada();
  /* Toda saída da rodada passa aqui. Se a manutenção passou e nada foi
     publicado, a troca de capa é devida — e um build quebrado fecha a rodada em
     vermelho, porque capa parada é a mesma falha de três semanas atrás. */
  let causaVermelha = codigo !== 0 ? why : "";
  if (posManutencao && !publicou) {
    const rc = girarCapa();
    if (rc !== 0) causaVermelha = causaVermelha || `o build da capa falhou (exit ${rc})`;
    codigo = Math.max(codigo, rc === 0 ? 0 : 1);
  }
  /* A prova final não é o exit do build, é o histórico: a capa TROCOU nesta
     rodada? `registrarCapa` só grava quando o hero foi ao ar com outra matéria,
     então rodada verde com a capa no mesmo lugar é vermelha a partir daqui — foi
     exatamente assim que a meta viveu três semanas como promessa. Vale também
     para a rodada que publicou: lá quem gira é o build chamado pelo publish.js. */
  if (posManutencao && !capaServiuRodada()) {
    causaVermelha = causaVermelha || "a rodada fechou sem troca de capa no hero";
    codigo = Math.max(codigo, 1);
  }
  if (why) say("fim", why);
  /* O token é o que o vigia procura no bloco do turno.log. Quem barra a rodada
     no runner já imprime "VERMELHO: …"; quando quem barra é o `turno.js`, a
     causa morria no exit code e o vigia cantava "servida e empurrada" numa
     rodada sem texto — medido 14/11, duas rodadas, zero publicações, aviso
     verde. Para o diário, a linha vai escrita no fim, depois das etapas que
     mostram o caminho percorrido. */
  if (codigo !== 0) {
    const linha = `VERMELHO: ${causaVermelha || why || "rodada vermelha sem causa declarada"}`;
    log.push(`- **portão** — ${linha}`);
    console.log(linha);
  }
  const head = `# Turno — ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC\n\n`;
  fs.writeFileSync(path.join(ROOT, "TURNO.md"), head + log.join("\n") + "\n");
  /* O horário só é declarado servido na saída que DECIDE o desfecho — e aqui o
     desfecho já está decidido: as fotos foram desfeitas, a capa cobrada e a
     prova lida do disco. Marcar antes seria apagar a chance da mão seguinte:
     rodada que morre no meio (exceção sem catch, sinal, exit não-zero deste
     `finish`) deixa de servir o horário de propósito, porque com o portão
     fechado a única coisa que ela garantiria é um buraco na agenda. Verde com
     nada publicado também conta como servido — teto atingido, intervalo mínimo
     e falta de pauta são o horário cumprido, não um horário perdido.         */
  if (codigo === 0) roundLock.marcarServida({ resultado: why || "rodada verde" }, new Date(), ROOT);
  process.exit(codigo);
};

/* Ctrl+C do dono e `timeout-minutes: 45` do Actions derrubam o processo por
   SINAL, e listener de "exit" não roda em sinal: a rodada interrompida deixava
   o jpg da matéria que não saiu no disco — e como ele passa a constar no
   retrato das rodadas seguintes, nada mais o apaga, até o `git add images` de
   uma publicação futura commitá-lo junto com outra matéria. Vai por `finish` de
   propósito: desfaz as fotos, escreve o TURNO.md dizendo o que houve e sai
   vermelho, porque interrupção não é rodada verde. Registrado DEPOIS do `finish`
   porque ele é `const`: chamar antes da definição arremessa um
   ReferenceError — medido nesta máquina. */
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => finish(`rodada interrompida por ${sig} — nada publicado`, 1));
}

/* Mesmo teste de tools/publish.js: foto de banco vale, placa SVG nossa não. */
const temFotoReal = (slug) => {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "drafts", slug, "draft.json"), "utf8"));
    const eh = (img) => img && /\.(jpg|jpeg|png|webp)$/i.test(img) && !String(img).startsWith("images/covers/");
    return Boolean(eh(d.image) || eh(d.bookCover));
  } catch {
    return false;
  }
};

/* Foto real primeiro, placa depois. publish.js exige foto de banco desde
   2026-11-06 e make-cover.js já sai sem escrever nada quando o draft tem foto,
   então essa ordem evita o SVG órfão que o `git add images` do workflow
   commiteava. Buscar aqui também é o que faz a rodada avisar por issue a tempo,
   em vez de morrer no portão do publish. */
function garantirFoto(slug) {
  if (temFotoReal(slug)) return { achada: true, ja: true, linha: "foto real já no draft" };
  const foto = run("find-cover.js", [slug]);
  const tail = foto.out.trim().split("\n").filter(Boolean).slice(-2).join(" · ").slice(0, 200);
  return {
    achada: foto.code === 0,
    ja: false,
    linha: foto.code === 0 ? (foto.out.match(/✓ foto encontrada.*/) || ["foto encontrada"])[0] : `nenhuma foto: ${tail}`,
  };
}

/* Rodada que não publicou também tem de cumprir a meta de capa. Quem troca a
   capa é o build.js (slot index-hero + lib/cover-state.js), e até 2026-11-07 ele
   só era chamado pelo publish.js: parada por teto, por distância mínima ou por
   falta de pauta não rodava build, a rodada fechava sem troca nenhuma e a meta
   de cover_changes_per_day ia a zero em silêncio — o commit que "força a troca"
   só funcionava nos dias em que saía matéria. Desde 2026-11-07 a meta é UMA
   TROCA POR RODADA (`cover_changes_per_day`, que o doctor exige igual ao número
   de horários do `check_hours` — o número mora no JSON, não aqui): sem matéria
   nova, o build caminha na lista de elegíveis e põe outra matéria no hero. */
function girarCapa() {
  const b = run("build.js");
  const linha = (b.out.match(/index-hero:[^\n]*/) || [""])[0].trim();
  if (b.code !== 0) {
    say("capa", `build da capa falhou (exit ${b.code}): ${b.out.trim().slice(-220) || "sem saída do build — rode node tools/build.js na mão"}`);
    return b.code;
  }
  /* Exit 0 do build não quer dizer capa no ar: sem o marcador
     `hwp:auto:index-hero` no HTML ele imprime "+0 (container não encontrado)" e
     sai verde. Cobrar a linha é o que transforma "a capa girou" em algo medido
     em vez de promessa — capa parada foi exatamente a falha de três semanas. */
  if (!linha) {
    say("capa", `build verde mas nenhuma linha de capa na saída — o slot index-hero não existe no HTML (confira pipeline/placements.json e os marcadores em index.html)`);
    return 1;
  }
  if (/container não encontrado/.test(linha)) {
    say("capa", `slot index-hero sem marcadores no HTML: ${linha} — nada trocado`);
    return 1;
  }
  say("capa", linha);
  return 0;
}

/* Lê o estado DA DISCO (o build acabou de escrever) e diz se a capa trocou na
   rodada em curso. Não é redundância do `girarCapa`: o build pode sair 0 sem
   trocar nada (uma matéria elegível sozinha no catálogo, nenhuma acima do piso,
   ou um rebuild depois de a rodada já ter girado por outro caminho), e o que a
   meta cobra é a troca, não o build. */
function capaServiuRodada() {
  const coverState = require("./lib/cover-state");
  const estado = coverState.loadState();
  if (coverState.trocaNaRodada(estado)) return true;
  const cad = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "cadence.json"), "utf8"));
    } catch {
      return {};
    }
  })();
  say(
    "capa",
    `VERMELHO: nenhuma troca de capa registrada na rodada ${coverState.rodadaId()} — o hero continua em ${estado.currentCoverId || "capa escrita à mão"}. ` +
      `A meta é ${cad.cover_changes_per_day}/dia (uma por rodada) e o piso é ${cad.cover_baseline}: confira quantas matérias do catálogo têm nota medida acima do piso e foto real em pipeline/scores.json`
  );
  return false;
}

/* 0. portão do horário: esta rodada do `check_hours` já foi servida?

   Com a segunda mão no relógio (a automação agendada do app, além do timer do
   systemd), o `flock -n` do runner não basta: ele serializa SOBREPOSIÇÃO, e a
   invocação que acorda 45 min depois da primeira encontra o lock livre e roda a
   rodada inteira dentro do MESMO horário — capa não pode girar (uma troca por
   `rodadaId()`), nada pode publicar (o intervalo mínimo é o espaçamento dos
   horários), e ainda assim o passo 5 queima uma pauta por 6h e o redator gasta
   ~13 min do plano. É o preço de sempre do AGENTS.md ("olhar a fila não pode
   custar pauta"), cobrado agora do próprio relógio.

   Verde por desenho: mão duplicada não é defeito editorial, e vermelho faria o
   recuo do runner desfazer o trabalho BOM da primeira mão do horário. O exit 0
   também não engana o vigia: sem `VERMELHO` no bloco nem código não-zero, ele
   lê "servida e empurrada" — que é exatamente o que aconteceu.

   `--force-slot` é a saída deliberada para o caminho manual documentado em
   AGENTS.md ("rode o passo a passo à mão"): uma rodada manual depois da do
   manhã tem de poder rodar.                                            */
const roundLock = require("./lib/round-lock");
const FORCAR = process.argv.includes("--force-slot");
if (FORCAR) {
  say("horário", `portão de idempotência ignorado por --force-slot (${roundLock.chave()}) — o dono mandou rodar mesmo assim`);
} else if (roundLock.jaServida(new Date(), ROOT)) {
  saidaCurta(
    `rodada duplicada: o horário ${roundLock.chave()} já foi servido nesta agenda — nada coletado, nenhuma pauta queimada, nenhum minuto de redator gasto.`
  );
}

/* 1. coleta */
const ing = run("ingest.js");
/* O resumo da fila e os feeds que falharam: mostrar só a última linha deixava
   "2/12 feeds fora do ar" invisível no relatório — e pauta velha sem fonte nova
   é o mesmo que robô desligado. */
const fila = (ing.out.match(/fila: .*/g) || []).pop() || "";
const feedsRuins = (ing.out.match(/^\s*! .*$/gm) || []).map((l) => l.trim().slice(2)).slice(0, 4);
say(
  "coleta",
  ing.code === 0
    ? [fila || "ok", feedsRuins.length ? `feeds fora: ${feedsRuins.join("; ")}` : ""].filter(Boolean).join(" · ")
    : `falhou: ${ing.out.slice(-200)}`,
);

/* 2. rotação diária ANTES da manutenção. O doctor exige que o bloco TODAY'S
   PICKS publicado seja o que a régua de hoje calcula, e quem produz esse bloco
   é o build — que até 10/11 só rodava no fim da rodada (publish ou girarCapa).
   Na virada do dia UTC o portão nascia vermelho por construção, a rodada parava
   aqui, o bloco nunca girava e a rodada seguinte morria do mesmo jeito: três
   rodadas seguidas assim no Actions, site congelado desde 08/11. `--daily` gira
   só os blocos de rotação diária e não toca na capa, para a matéria inédita
   ainda tomar o hero na primeira publicação da rodada. */
const giro = run("build.js", ["--daily"]);
say("rotação diária", giro.code === 0 ? (giro.out.trim().split("\n").pop() || "ok") : `build --daily falhou (exit ${giro.code}): ${giro.out.trim().slice(-220)}`);
if (giro.code !== 0) finish("a rotação diária falhou — sem ela o bloco do dia fica velho no ar e o doctor barra a rodada seguinte.", 1);

/* 3. manutenção: com erro aberto não se publica nada */
const doc = run("doctor.js", ["--offline"]);
const docLine = (doc.out.match(/errors \d+ \| .*warnings \d+/) || ["sem resumo"])[0];
say("manutenção", docLine);
/* Vermelho de propósito: dia inteiro com o CI verde e nenhuma publicação foi
   possível enquanto um erro aberto barrava a rodada no meio do caminho. */
if (doc.code !== 0) finish("doctor terminou com erros — a rodada para aqui por segurança.", 1);
posManutencao = true;

/* 4. teto diário */
const cad = JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "cadence.json"), "utf8"));
const done = require("./lib/cadence").publishedToday(ROOT);
say("cadência", `${done}/${cad.max_publishes_per_day} publicação(ões) hoje`);
if (done >= cad.max_publishes_per_day) finish("teto diário atingido — as próximas rodadas só coletam e checam.");
/* A distância mínima entre publicações é checada aqui, antes de escolher pauta:
   barrada só no publish.js, a rodada gastava brief + texto + editor e ainda
   marcava a pauta como falha_publicacao, que a deixa 24h fora da fila. Vale
   também depois da virada do dia UTC — com teto de 1 por dia e gap de 20h, uma
   publicação às 21h fazia as rodadas da manhã seguinte percorrerem a pipeline
   inteira para então serem barradas no fim, com o CI verde. */
const horasDesde = require("./lib/cadence").horasDesdeUltimaPublicacao(ROOT);
const minimoHoras = Number(cad.min_hours_between_publishes || 0);
if (horasDesde !== null && minimoHoras && horasDesde < minimoHoras) {
  finish(`cadência: a última matéria está no ar há ${horasDesde.toFixed(1)}h (mínimo ${minimoHoras}h) — esta rodada só coleta e checa.`);
}

/* 4.5 redator armado. A conferência vivia no passo 7, depois de o passo 5 já
   ter marcado a pauta como `em_andamento` — 6h fora da fila para nenhuma
   escrita, e o `pick-lead` ainda a dava como tomada pelo diretório de rascunho
   que o passo 6 criaria. O cinto confere isto antes de chamar o turno, mas o
   portão tem de estar AQUI também: `--force-slot` e o caminho manual do
   AGENTS.md (`node tools/turno.js` à mão) não passam pelo preflight do runner.
   Chegar aqui já quer dizer publicar: os dois travões de cadência do passo 4
   encerram a rodada antes, então o verde de "dia sem matéria" não é atingido
   por uma emergência de redator desarmado.                                      */
const prov = require("./lib/providers");
if (!prov.armados().length)
  finish(`nenhum provedor de texto armado — o redator não roda, e nenhuma pauta foi queimada para descobrir isso. O que falta: ${prov.configurados().map((p) => `${p.nome}→${prov.rotulo(p)}`).join(", ")}.`, 1);

/* 5. pauta */
const mem = require("./lib/memory");
const pick = run("pick-lead.js");
if (pick.code !== 0) finish(pick.out.trim() || "sem pauta nova.");
const lead = JSON.parse(pick.out.trim().split("\n").pop());
say("pauta", `${lead.topic} (${lead.source}, score ${lead.score})`);

/* 6. brief */
const briefArgs = ["--url", lead.url, "--pillar", lead.pillar, "--topic", lead.topic, "--slug", lead.slug];
if (lead.published) briefArgs.push("--source-date", lead.published);
const brief = run("new-post.js", briefArgs);
if (brief.code !== 0) {
  mem.registrar(ROOT, lead.url, "falha_brief", { slug: lead.slug, topic: lead.topic });
  /* Vermelho: `new-post.js` só sai com exit != 0 quando arrebenta, e a pauta que
     o passo 5 já marcou `em_andamento` morre ali — é a mesma conta do passo 7
     abaixo: pipeline percorrida, nada no ar. */
  finish(`brief falhou: ${brief.out.slice(-300)}`, 1);
}
say("brief", `pipeline/drafts/${lead.slug}/ criado`);

/* 7. texto */
/* O redator já foi conferido no passo 4.5, antes de a pauta ser comprometida:
   sem provedor armado a rodada para antes de gastar brief, texto e júri. */
const wrote = run("write.js", [lead.slug]);
if (wrote.code !== 0) {
  mem.registrar(ROOT, lead.url, "falha_texto", { slug: lead.slug, topic: lead.topic });
  /* Vermelho desde 14/11. Fechando verde, o runner não fazia o recuo, commitava
     `turno:` e empurrava, e o vigia — que procura `VERMELHO` no bloco da rodada
     — anunciava "servida e empurrada": medido hoje nas rodadas das 08:23 e
     12:23, ambas com `timeout de 300s no CLI`, zero publicações e aviso verde.
     É a mesma conta do abort do publish.js (06/11), um estágio mais cedo. */
  finish(`o redator não entregou texto: ${wrote.out.trim().split("\n").slice(-8).join(" · ").slice(0, 900)}`, 1);
}
say("texto", wrote.out.trim().split("\n")[0]);
say("foto", garantirFoto(lead.slug).linha);
const capa = run("make-cover.js", [lead.slug]);
say("capa", capa.code === 0 ? capa.out.trim().split("\n")[0] : `falhou: ${capa.out.trim().slice(-200)}`);

/* 8. editor mecânico, até 3 tentativas com devolutiva */
let check = { code: 1, out: "" };
let reescritaMorta = "";
for (let t = 1; t <= 3; t++) {
  check = run("check-post.js", [lead.slug]);
  if (check.code === 0) { say("edição", `aprovado na tentativa ${t}`); break; }
  const rejs = check.out.split("\n").filter((l) => l.includes("✗")).slice(0, 6).join("\n");
  say("edição", `tentativa ${t} reprovada: ${rejs.replace(/\n/g, " · ").slice(0, 220)}`);
  if (t === 3) break;
  fs.writeFileSync(path.join(ROOT, "pipeline", "drafts", lead.slug, "fix.md"),
    `O editor mecânico reprovou seu draft. Corrija EXATAMENTE estes pontos e devolva o JSON completo de novo:\n${rejs}\nNão mude o que já estava aprovado.`);
  const fix = run("write.js", [lead.slug]);
  if (fix.code !== 0) {
    /* A causa vai inteira, como no passo 7: `slice(-1)` deixava no diário só a
       linha de rodapé do write.js ("a rodada termina aqui de propósito") e
       jogava fora o que realmente matou a chamada — medido 15/11 às 05:44Z,
       uma frase de 33 palavras custou a noite e ninguém leu por quê. */
    reescritaMorta = fix.out.trim().split("\n").slice(-8).join(" · ").slice(0, 900);
    say("edição", `reescreva falhou: ${reescritaMorta}`);
    break;
  }
  /* O rascunho novo vem do modelo e perde a foto baixada: sem esta conferência
     a rodada aprovava na edição e morria no portão de foto do publish. */
  const refoto = garantirFoto(lead.slug);
  if (!refoto.ja) say("foto", refoto.linha);
  run("make-cover.js", [lead.slug]);
}
if (check.code !== 0) {
  if (reescritaMorta) {
    /* Quem morreu foi o redator, não o júri. Marcar `reprovada` enterrava a
       pauta por 72h por causa de um timeout de texto — o triplo da janela de
       `falha_texto` (24h em lead_retry_hours), que é justamente a classe deste
       defeito. Vermelho pelo mesmo contrato do passo 7: sem texto entregue a
       rodada não serve o horário, e a mão de reserva pode refazê-lo. */
    mem.registrar(ROOT, lead.url, "falha_texto", { slug: lead.slug, topic: lead.topic });
    finish(`a reescrita do editor não entregou texto: ${reescritaMorta}`, 1);
  }
  mem.registrar(ROOT, lead.url, "reprovada", { slug: lead.slug, topic: lead.topic });
  finish("rascunho ficou reprovado depois de 3 tentativas — nada publicado, e a pauta fica 72h fora da fila (pipeline/memory.json).");
}

/* 9. nota */
const sc = run("score.js", ["--draft", lead.slug]);
const nota = (sc.out.match(/nota ([\d.]+)\/10/) || [])[1];
say("nota", nota ? `${nota}/10 · ${(sc.out.split("\n")[1] || "").slice(0, 160)}` : sc.out.trim().split("\n")[0]);
if (/DUPLICATA/.test(sc.out)) {
  mem.registrar(ROOT, lead.url, "reprovada", { slug: lead.slug, topic: lead.topic, motivo: "duplicata" });
  finish("nota calculada aponta quase-duplicata — nada publicado.");
}

/* 10. publicação */
const pub = run("publish.js", [lead.slug]);
if (pub.code !== 0) {
  /* barrado pela cadência não é falha da pauta: sem este teste a janela de
     re-tentativa de 24h punia a pauta certa por causa do relógio. */
  if (/cadência:/.test(pub.out)) finish(`publicação barrada pela cadência: ${pub.out.trim().split("\n").filter((l) => /cadência:/.test(l)).pop()}`);
  mem.registrar(ROOT, lead.url, "falha_publicacao", { slug: lead.slug, topic: lead.topic });
  /* Vermelho de propósito: a pipeline inteira percorrida — pauta, brief, texto,
     editor, nota — e ainda assim nada publicado. Foi o verde deste finish que
     escondeu o travamento do portão de foto em 2026-11-06; medido no Actions,
     25 das 31 rodadas "success" terminaram sem publicar. */
  finish(`publicação abortada pelo publish.js: ${pub.out.trim().split("\n").filter(Boolean).slice(-3).join(" · ").slice(0, 400)}`, 1);
}
/* Daqui para frente a rodada publicou: o build do publish.js já colocou a
   matéria no hero e registrou a troca, então a capa não é mais devida. */
publicou = true;
say("publicação", pub.out.split("\n").filter((l) => /publicado localmente|cadência hoje|^AVISO:/.test(l)).join(" · ") || pub.out.trim().split("\n").slice(0, 2).join(" · "));
/* Um "AVISO:" aqui é contabilidade quebrada: a matéria está no ar, mas algo que
   o teto ou o histórico dependem não foi gravado. Rodada vermelha de propósito
   — foi assim que o commit "publish:" ficou mudo por dois dias. */
if (/AVISO:/.test(pub.out)) {
  say("alerta", "publicação registrada, mas a contabilidade falhou — leia a linha de publicação acima.");
  finish("rodada terminou com alerta.", 1);
}
finish("rodada completa. O commit `turno:` e o push são do runner (Actions ou hwp-turno.sh); o deploy é da Vercel.");
