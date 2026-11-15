/* providers.js — quem pode escrever o texto e em que ordem.
   A ordem e os endpoints moram em pipeline/providers.json. A chave, não: o
   JSON diz o NOME da variável de ambiente, e o provedor só entra na fila se
   essa variável existir. Provedor armado mas fora do ar é pulado; provedor
   sem chave é ignorado em silêncio (é o estado normal de quem ainda não criou
   a conta lá).

   Três tipos:
     gemini  — API própria do Google (descoberta + generateContent)
     openai  — qualquer endpoint compatível com /chat/completions
     cli     — um agente local chamado como subprocesso (o `qodercli` desta
               máquina desde 13/11). Não tem chave: entra na fila se o binário
               existe, e o prompt vai pelo stdin.                           */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { rank, diversificar } = require("./rank-models");

/* A chave pode vir do Secret do Actions ou do .env local; sem este carregador,
   quem roda a rodada na máquina tinha a chave no disco e via vermelho. */
require("./load-env").load();

const ROOT = path.resolve(__dirname, "..", "..");
const CONFIG = path.join(ROOT, "pipeline", "providers.json");

const NAO_ESCREVE = /embed|whisper|tts|guard|rerank|moderation|audio|image|vision|ocr|diffusion|transcribe/i;

/* O binário do CLI muda de nome a cada versão do app (qodercli-1.1.87 →
   qodercli-1.2.x), então caminho fixo não é régua: `bin` no JSON se existir,
   senão o mais novo em ~/.qoder/bin/qodercli/, senão o que estiver no PATH.
   Procurar toda vez é de propósito — o app se atualiza sozinho e a rodada não
   pode acordar com o redator apontando para um binário que já foi apagado. */
function localizar(p) {
  if (p.bin && fs.existsSync(p.bin)) return p.bin;
  const porEnv = process.env[p.bin_env || "QODER_CLI"];
  if (porEnv && fs.existsSync(porEnv)) return porEnv;
  const dir = path.join(process.env.HOME || "", ".qoder", "bin", "qodercli");
  let maisNovo = null;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!/^qodercli-\d+(\.\d+)*$/.test(f)) continue;
      if (!fs.existsSync(path.join(dir, f))) continue;
      if (!maisNovo || f.localeCompare(maisNovo, undefined, { numeric: true }) > 0) maisNovo = f;
    }
  } catch {}
  if (maisNovo) return path.join(dir, maisNovo);
  const nome = p.bin_nome || "qodercli";
  for (const pedaço of String(process.env.PATH || "").split(":").filter(Boolean)) {
    const candidato = path.join(pedaço, nome);
    try {
      if (fs.statSync(candidato).isFile()) return candidato;
    } catch {}
  }
  return null;
}

function configurados() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch (err) {
    console.error(`pipeline/providers.json ilegível: ${err.message}`);
    return [];
  }
  return ((raw && raw.provedores) || []).filter(
    (p) => p && p.ativo !== false && p.nome && (p.tipo === "cli" ? true : p.chave_env && p.endpoint)
  );
}

/* O que "falta" para este provedor entrar na fila, dito numa boca só pelo log,
   pelo painel e pelo pré-voice do runner: a variável de ambiente no HTTP, o
   binário no CLI. Sem isto, o TURNO.md diria "arme GEMINI_API_KEY" numa máquina
   onde o que não existe é o app. */
const rotulo = (p) => (p.tipo === "cli" ? `CLI ${p.bin_nome || "qodercli"}` : p.chave_env);

const armados = () =>
  configurados()
    .map((p) => {
      if (p.tipo === "cli") {
        const bin = localizar(p);
        return bin ? { ...p, bin } : null;
      }
      const chave = process.env[p.chave_env];
      return chave ? { ...p, chave } : null;
    })
    .filter(Boolean);

const desarmados = () =>
  configurados().filter((p) => (p.tipo === "cli" ? !localizar(p) : !process.env[p.chave_env]));

function reason(bodyText) {
  try {
    const j = JSON.parse(bodyText);
    return [j.error && (j.error.status || j.error.type), j.error && j.error.message].filter(Boolean).join(" · ") || String(bodyText).slice(0, 160);
  } catch {
    return String(bodyText).slice(0, 160);
  }
}

async function lista(p) {
  const url = p.tipo === "gemini" ? `${p.endpoint}/models?pageSize=200` : `${p.endpoint}/models`;
  const headers = p.tipo === "gemini" ? { "x-goog-api-key": p.chave } : { authorization: `Bearer ${p.chave}` };
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${reason(await res.text().catch(() => ""))}`);
  return res.json();
}

/* Devolve {modelos, erro}. Nunca lança: provedor indisponível é um motivo a
   registrar, não um motivo para derrubar a rodada. */
async function descobrir(p) {
  const teto = Number(p.modelos_por_rodada || 2);
  const reserva = Array.isArray(p.fila) ? p.fila : Array.isArray(p.reserva) ? p.reserva : [];
  /* O CLI não tem listagem de modelos: quem usa o plano do app escreve com o
     modelo que o plano dá, e a fila tem um item só. Declarar `fila` no JSON é o
     jeito de passar `-m <modelo>` quando a conta tiver mais de um. */
  if (p.tipo === "cli") return { modelos: reserva.length ? reserva.slice(0, teto) : ["plano-do-app"], erro: null };
  let json;
  try {
    json = await lista(p);
  } catch (err) {
    return { modelos: reserva.slice(0, teto), erro: `não listou modelos (${err.message}); usando a fila de reserva` };
  }

  let nomes;
  if (p.tipo === "gemini") {
    nomes = ((json && json.models) || [])
      .filter((m) => !m.supportedMethods || !m.supportedMethods.length || m.supportedMethods.includes("generateContent"))
      .map((m) => String(m.name || "").replace(/^models\//, ""))
      .filter((n) => n && !/embedding|-image|-tts|-live|computer-use|aqa|lyria|robotics|nano-banana|-omni|transcribe/i.test(n));
    nomes = diversificar(rank(nomes), teto);
  } else {
    nomes = ((json && json.data) || []).map((m) => String(m.id || "")).filter((n) => n && !NAO_ESCREVE.test(n));
    if (p.filtro) {
      const re = new RegExp(p.filtro);
      nomes = nomes.filter((n) => re.test(n));
    }
    /* A ordem declarada no JSON manda; o que a descoberta achou de novo entra
       atrás, para o provedor não ficar mudo quando renomearem um modelo. */
    const preferidos = reserva.filter((n) => !nomes.length || nomes.includes(n));
    nomes = [...new Set([...preferidos, ...nomes])].slice(0, teto);
  }
  if (!nomes.length) return { modelos: reserva.slice(0, teto), erro: "a listagem não trouxe modelo de texto" };
  return { modelos: nomes, erro: null };
}

/* A árvore do redator, morta por PID e não só pelo filho direto.

   A régua é a medição de 15/11, 06:56Z, na rodada que morreu no
   `chamada_max_ms`: o `spawnSync({timeout})` manda SIGTERM só para o processo
   que ele mesmo lançou, e o `qodercli` do app não é um processo — é um pai que
   levanta um worker, e o worker levanta outro. Mortos os diretos (turno.js,
   write.js, qodercli), o worker viveu 81 s e 105 s e o bisneto 40 s. Três
   consequências, todas caras: o `timeout 65m` do cinto deixou de ser a
   garantia de fim de rodada (e o `TimeoutStartSec=78min`, por cima dele,
   também); o plano do app continuou sendo gasto dentro da rodada seguinte; e o
   `desfazerFotosDaRodada()` apagou jpgs que um escritor órfão ainda ia usar.

   Quatro bocas, cada uma para um formato da árvore no momento do corte:
     1. o GRUPO do filho, que é líder porque o lançamos `detached`: varre de uma
        vez tudo o que nasceu nele e continuou nele, inclusive quando o pai já
        morreu há tempo — é a boca da chamada verde que deixa worker de fundo;
     2. descida por `/proc` a partir do filho direto — alcança o que o worker
        reposicionou fora do grupo (setpgid/setsid) enquanto o pai está vivo, que
        é o caso do timeout interno;
     3. o censo abaixo, que grava a árvore enquanto ela ainda é alcançável e mata
        por PID+carimbo de nascimento — a boca do caso 2 quando o pai já foi
        colhido e os netos estão no PID 1;
     4. o relay de sinal e o `process.on("exit")`, que refazem 1..3 quando a
        saída não passa pela chamada: Ctrl+C, `timeout` do cinto,
        `TimeoutStartSec` do systemd, exceção sem catch.
   O `detached` sozinho não chega: com grupo próprio, o filho sai do grupo da
   rodada, e é exatamente esse grupo que o `timeout 65m` do cinto mata — sem o
   relay (boca 4) a parede de 65 min teria passado a CRIAR órfão em vez de
   matá-lo. O `detached` sozinho também não é suficiente para o worker que se
   reposiciona, e a descida sozinha não é suficiente para o pai já colhido: as
   quatro juntas são o que a medição de 15/11 pede.
   O que sobra, declarado: um neto gerado depois do último censo e reposicionado
   para fora do grupo antes de o pai morrer — janela de um segundo no caminho
   longo, vinte e cinco centésimos nos primeiros 5 s, e ela é janela, não buraco
   silencioso. */
function descendentes(pid) {
  const porPai = new Map();
  let entradas = [];
  try {
    entradas = fs.readdirSync("/proc");
  } catch {
    return [];
  }
  for (const nome of entradas) {
    if (!/^\d+$/.test(nome)) continue;
    let stat = "";
    try {
      stat = fs.readFileSync(path.join("/proc", nome, "stat"), "utf8");
    } catch {
      continue;
    }
    /* Campo 2 é o nome entre parênteses e pode ter espaço ou parênteses:
       ancorar no ÚLTIMO ")" é o que não desfoca o ppid que vem depois. */
    const fim = stat.lastIndexOf(")");
    if (fim < 0) continue;
    const depois = stat.slice(fim + 1).trim().split(/\s+/);
    const ppid = Number(depois[1]);
    if (!Number.isFinite(ppid)) continue;
    const lista = porPai.get(ppid) || [];
    lista.push(Number(nome));
    porPai.set(ppid, lista);
  }
  const ordem = [];
  const fila = [pid];
  while (fila.length) {
    const atual = fila.shift();
    for (const filho of porPai.get(atual) || []) {
      ordem.push(filho);
      fila.push(filho);
    }
  }
  return ordem.reverse();
}

/* O carimbo de nascimento do processo (campo 22 de /proc/pid/stat): é o que
   distingue o PID gravado no censo de um PID reciclado depois que ele morreu. */
function identidade(pid) {
  let stat = "";
  try {
    stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return null;
  }
  const fim = stat.lastIndexOf(")");
  if (fim < 0) return null;
  return stat.slice(fim + 1).trim().split(/\s+/)[19] || null;
}

function matarArvore(pid) {
  for (const p of descendentes(pid)) {
    try {
      process.kill(p, "SIGKILL");
    } catch {}
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}

/* O grupo do filho: com `detached`, ele é líder, e um SIGKILL no `-pid` varre o
   que nasceu naquele grupo mesmo depois de o líder virar zumbi e ser colhido.
   Grupo vazio ou filho que nunca levantou ninguém: ESRCH, engolido de propósito. */
function matarGrupo(pid) {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {}
}

/* A segunda passada, a que sobrevive à morte do pai. Morto e colhido o filho
   direto, os descendentes vão para o PID 1 e a descida por `/proc` não os acha
   mais. Por isso o censo: a cada CENSO_MS a árvore é lida e guardada com o
   carimbo de nascimento, e no fim da chamada morre também o que o censo viu mas
   a descida já não alcança. Um `readdirSync` + ~300 `stat` por segundo dentro de
   uma chamada de 13 min é preço que se paga de bom grado pelo que ele compra.
   Sem `/proc` (outro SO, ou escondido num contêiner) o censo fica vazio e sobra
   o kill do filho direto, exatamente como era antes. */
const CENSO_MS = 1000;
/* Rajada no começo da chamada: é nos primeiros segundos que o pai do redator
   levanta o worker, e um worker nascido depois do último censo e antes de o pai
   morrer é o único órfão que a descida já não alcança. 250 ms durante 5 s custa
   vinte varreduras de `/proc` e estreita a janela para o lado que importa. */
const CENSO_RAJADA_MS = 250;
const CENSO_RAJADA_ATÉ = 5000;
function recensear(pid, vistos) {
  for (const p of descendentes(pid)) {
    if (!vistos.has(p)) {
      const carimbo = identidade(p);
      if (carimbo !== null) vistos.set(p, carimbo);
    }
  }
  return vistos;
}

function matarCenso(vistos) {
  for (const p of [...vistos.keys()].reverse()) {
    if (identidade(p) === vistos.get(p)) {
      try {
        process.kill(p, "SIGKILL");
      } catch {}
    }
  }
}

/* Filhos vivos desta chamada → a árvore que o censo já viu. */
const emChamada = new Map();

/* A varredura completa, na ordem das quatro bocas: descida (alcança o que se
   reposicionou enquanto o pai vive), grupo (varre o que nasceu no grupo do
   filho, vivo o pai ou não), censo (mata por PID+carimbo o que a descida já não
   acha porque o pai foi colhido) e, por último, o filho direto. */
function podar(pid, vistos) {
  if (!Number.isInteger(pid)) return;
  recensear(pid, vistos);
  matarGrupo(pid);
  matarCenso(vistos);
  matarArvore(pid);
}

function podarTudo() {
  for (const [pid, vistos] of emChamada) podar(pid, vistos);
  emChamada.clear();
}

/* O timeout interno não é a única porta de saída: Ctrl+C, o `timeout 65m` do
   cinto, o `TimeoutStartSec` do systemd e uma exceção sem catch também desarmam
   o relógio da chamada. `process.on("exit")` cobre os que terminam em saída
   normal ou por exceção; os mortos por sinal NÃO rodam o gancho de saída — é
   por isso que o relay abaixo existe, e é por isso que o filho pode ser
   `detached` sem que a parede do cinto perca a palavra.
   O relay devolve o sinal depois de podar, retirando SÓ o seu próprio ouvinte:
   remover todos os ouvintes levaria junto o tratante de SIGTERM do `turno.js`,
   que é quem faz o `desfazerFotosDaRodada()`. */
const SINAIS_DE_PODA = ["SIGTERM", "SIGINT", "SIGHUP"];
const relays = new Map();
for (const sig of SINAIS_DE_PODA) {
  const ouvir = () => {
    podarTudo();
    process.removeListener(sig, ouvir);
    relays.delete(sig);
    try {
      process.kill(process.pid, sig);
    } catch {}
  };
  relays.set(sig, ouvir);
  process.on(sig, ouvir);
}
process.on("exit", podarTudo);

/* O mesmo contrato para os três tipos: um objeto com .ok, .status, .text() e
   .json(). No CLI ele é fabricado a partir do subprocesso, para o write.js não
   ter duas rotas de leitura. */
async function chamarCli(p, modelo, prompt, timeoutMs) {
  /* O teto de parede do write.js (14 min) já chegou aqui pelo prazo, então o
     clamp só pode ficar ACIMA do maior `chamada_max_ms` declarado: cortado em
     600s, o 780000 do CLI virava cifra morta no JSON e a chamada era partida
     viva nos 22s que separam a medição de 578s do teto real. */
  const ms = Math.round(Math.max(30000, Math.min(840000, timeoutMs)));
  const arg = [
    "-p",
    "--no-session-persistence",
    /* Sem ferramentas, o redator não tem como escrever arquivo nem rodar
       comando: ele devolve texto e só. O prompt.md já traz o contrato inteiro,
       então o agente não precisa enxergar o repositório para escrever a matéria
       — e não pode mexer nela. */
    "--tools",
    "",
  ];
  if (modelo && modelo !== "plano-do-app") arg.push("-m", modelo);
  if (p.max_tokens) arg.push("--max-output-tokens", String(p.max_tokens));
  /* O filho não pode herdar a marca de sessão do SDK. Medido em 15/11, 01:40:
     com `QODER_AGENT_SDK_ENTRYPOINT` no ambiente, o mesmo `qodercli` 1.1.87
     responde `sdk_worker_removed: SDK worker sessions are no longer supported`,
     sai 42 e não escreve uma linha; removida só essa variável ele devolve
     texto. Sob systemd o manager do usuário não tem a variável — é por isso que
     a rodada do timer escreve desde 13/11. Lançado de dentro de uma sessão do
     app (o LOOP R, mão de reserva 22 min depois de cada horário, ou um
     `node tools/turno.js` na mão do dono) o redator estaria morto, a rodada
     fecharia vermelha no passo 7 e a pauta iria para `falha_texto`. O `bin` já
     foi resolvido pelo `localizar()` acima, então limpar o ambiente do filho não
     muda qual executável roda. */
  const ambiente = { ...process.env };
  delete ambiente.QODER_AGENT_SDK_ENTRYPOINT;
  /* `detached` aqui não é desapego do chamador: é para o filho nascer LÍDER de
     grupo, porque um SIGKILL no grupo varre o worker que ele levanta sem que a
     gente precise adivinhar quando ele nasceu. Quem segura o grupo da rodada na
     parede do cinto é o relay de sinal acima — sem ele, `detached` teria
     trocado um órfão medido por um órfão novo. */
  return new Promise((resolve) => {
    let filho;
    try {
      filho = spawn(p.bin, arg, { cwd: ROOT, env: ambiente, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      resolve(resposta(false, 500, "", `o CLI não levantou: ${e.message}`));
      return;
    }
    let saida = "";
    let erro = "";
    let bytes = 0;
    let cortado = false;
    let estouro = false;
    let fechado = false;
    let código = null;
    let sinal = null;
    let falhaDeSpawn = null;
    let dreno = null;
    const pid = Number.isInteger(filho.pid) ? filho.pid : null;
    const vistos = new Map();
    const matar = () => {
      if (!pid) return;
      podar(pid, vistos);
    };
    if (pid) {
      emChamada.set(pid, vistos);
      recensear(pid, vistos);
    }
    const censo = pid ? setInterval(() => recensear(pid, vistos), CENSO_MS) : null;
    if (censo) censo.unref();
    const rajada = pid ? setInterval(() => recensear(pid, vistos), CENSO_RAJADA_MS) : null;
    if (rajada) rajada.unref();
    const atéRajada = pid ? setTimeout(() => clearInterval(rajada), CENSO_RAJADA_ATÉ) : null;
    if (atéRajada) atéRajada.unref();
    const relógio = setTimeout(() => {
      cortado = true;
      matar();
    }, ms);
    filho.stdout.on("data", (c) => {
      bytes += c.length;
      /* O antigo maxBuffer de 32 MB era uma recusa silenciosa: estourado, o
         spawnSync devolvia stdout truncado e o JSON não parseava. Aqui o
         excesso corta a chamada e diz por quê. */
      if (bytes > 64 * 1024 * 1024) {
        estouro = true;
        matar();
        return;
      }
      saida += c;
    });
    filho.stderr.on("data", (c) => {
      erro = (erro + c).slice(-4000);
    });
    /* O filho morrendo antes de o stdin fechar é o caminho normal do timeout e
       do erro de binário: sem este guard o EPIPE sobe como exceção não tratada
       e derruba o write.js inteiro. */
    filho.stdin.on("error", () => {});
    try { filho.stdin.end(prompt + CLI_CAUDA); } catch {}
    const acabar = () => {
      if (fechado) return;
      fechado = true;
      clearTimeout(relógio);
      if (dreno) clearTimeout(dreno);
      if (censo) clearInterval(censo);
      if (rajada) clearInterval(rajada);
      if (atéRajada) clearTimeout(atéRajada);
      if (pid) emChamada.delete(pid);
      /* Matar a árvore também no caminho verde: um `qodercli` que devolve o
         JSON e deixa um worker de fundo atrás de si é exatamente o órfão que a
         medição de 15/11 achou vivo minutos depois da chamada terminar. */
      matar();
      resolve(veredito());
    };
    const veredito = () => {
      if (falhaDeSpawn) return resposta(false, 500, "", falhaDeSpawn);
      if (estouro) return resposta(false, 500, "", `a resposta passou de 64 MB (timeout de ${Math.round(ms / 1000)}s)`);
      if (cortado) return resposta(false, 500, "", `timeout de ${Math.round(ms / 1000)}s no CLI`);
      if (sinal) return resposta(false, 500, saida, `o CLI foi morto por ${sinal} (timeout de ${Math.round(ms / 1000)}s)`);
      if (código !== 0) {
        const status = /quota|limit exceeded|402|payment|credit|usage/i.test(erro + saida) ? 429 : 500;
        /* Nenhuma fatia aqui: este texto é lido por `transporte.esperaCura()` para
           decidir se a rodada dorme ou passa a vez, e um token de pacote enterrado
           num preâmbulo longo deixava de existir para a decisão. Medido 15/11 pelo
           revisor (F5): o MESMO `ECONNREFUSED` no começo da corda dava `definitivo`
           em 0,2 s; ~443 chars para dentro dava `esperando 15s`. O corte é da
           FRASE DO DIÁRIO, e mora em `reason()` — não na matéria-prima. A corda já
           vem limitada em cima: o acumulador do stderr guarda os últimos 4000.  */
        return resposta(false, status, saida, `saiu com ${código}: ${(erro || saida).trim()}`);
      }
      if (!saida.trim()) return resposta(false, 500, "", "voltou sem texto nenhum");
      return resposta(true, 200, saida, "");
    };
    filho.on("error", (e) => {
      falhaDeSpawn = e.code === "ENOENT" ? `o binário ${p.bin} não está no disco` : e.message;
      acabar();
    });
    filho.on("exit", (code, sig) => {
      código = code;
      sinal = sig;
      /* `exit` chega antes do último bloco de stdout ser despejado no ouvinte,
         e o `spawnSync` que substitui entrega o buffer inteiro já fechado. Sem
         esta folga de 1,5 s a chamada verde seria lida truncada e o JSON
         morreria no parse — o `close` encerra na hora quando o pipe é só do
         filho; quem segura o stdout é o worker, e esse é morto pelo `matar()`. */
      dreno = setTimeout(acabar, 1500);
    });
    filho.on("close", acabar);
  });
}

const CLI_CAUDA =
  "\n\nResponda SOMENTE com o JSON do output contract, sem cercas de código e sem comentário antes ou depois.";

function resposta(ok, status, texto, motivo) {
  return {
    ok,
    status,
    async json() {
      return ok ? { texto } : { erro: motivo };
    },
    async text() {
      return ok ? texto : motivo;
    },
  };
}

/* Quem escreve o corpo de uma resposta do CLI é ESTA máquina: o spawn que não
   levantou, a parede de tempo, o exit code do filho. Num provedor de HTTP o
   corpo chega do DESTINO, e a prosa dele não é sintoma daqui. `origem()` é a
   única boca que diz de quem é o corpo; o que cada origem prova — se espera
   cura ou se é preciso passar a vez — mora em `lib/transporte.js`.          */
async function marcarOrigem(promessa) {
  const res = await promessa;
  return { ...res, origem: "local" };
}

const origem = (res) => (res && res.origem === "local" ? "local" : "remoto");

function chamar(p, modelo, prompt, timeoutMs) {
  if (p.tipo === "cli") return marcarOrigem(chamarCli(p, modelo, prompt, timeoutMs));
  /* AbortSignal.timeout recusa fração: a fatia de tempo sai de uma divisão. */
  const signal = AbortSignal.timeout(Math.round(Math.max(30000, Math.min(240000, timeoutMs))));
  if (p.tipo === "gemini") {
    return fetch(`${p.endpoint}/models/${modelo}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": p.chave },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt + "\n\nResponda SOMENTE com o JSON do output contract. Sem cercas de código, sem comentário." }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.9, maxOutputTokens: 8192 },
      }),
      signal,
    });
  }
  return fetch(`${p.endpoint}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${p.chave}` },
    body: JSON.stringify({
      model: modelo,
      messages: [{ role: "user", content: prompt + "\n\nResponda SOMENTE com o JSON do output contract. Sem cercas de código, sem comentário." }],
      temperature: 0.9,
      /* Modelos que "pensam" gastam o teto no raciocínio e devolvem texto
         vazio; o provedor que precisa de folga declara quanto. */
      ...(p.max_tokens ? { max_tokens: Number(p.max_tokens) } : {}),
      ...(p.reasoning_effort ? { reasoning_effort: p.reasoning_effort } : {}),
    }),
    signal,
  });
}

/* {texto} ou {motivo}. O corte de cercas de código fica com quem chama. */
function extrair(p, json) {
  if (!json) return { motivo: "resposta não era JSON" };
  if (p.tipo === "cli") {
    const texto = String(json.texto || "");
    return texto.trim() ? { texto } : { motivo: String(json.erro || "voltou sem texto") };
  }
  if (p.tipo === "gemini") {
    const cand = (json.candidates || [])[0] || {};
    if (!cand.content) {
      const blocked = ((json.promptFeedback || {}).blockReason || {}).reason;
      return { motivo: `voltou sem texto (${cand.finishReason || blocked || "resposta vazia"})` };
    }
    const texto = (cand.content.parts || []).map((x) => x.text || "").join("");
    return texto ? { texto } : { motivo: `voltou sem texto (${cand.finishReason || "vazio"})` };
  }
  const esc = (json.choices || [])[0] || {};
  const msg = esc.message || {};
  const texto = Array.isArray(msg.content) ? msg.content.map((c) => c.text || "").join("") : String(msg.content || "");
  if (!texto) {
    const e = json.error ? reason(JSON.stringify(json)) : null;
    return { motivo: e || `voltou sem texto (${esc.finish_reason || "resposta vazia"})` };
  }
  return { texto };
}

module.exports = { configurados, armados, desarmados, descobrir, chamar, extrair, reason, rotulo, localizar, origem };
