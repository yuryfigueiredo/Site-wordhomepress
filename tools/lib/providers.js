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
const { spawnSync } = require("child_process");
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

/* O mesmo contrato para os três tipos: um objeto com .ok, .status, .text() e
   .json(). No CLI ele é fabricado a partir do subprocesso, para o write.js não
   ter duas rotas de leitura. */
function chamarCli(p, modelo, prompt, timeoutMs) {
  const ms = Math.round(Math.max(30000, Math.min(600000, timeoutMs)));
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
  const r = spawnSync(p.bin, arg, { input: prompt + CLI_CAUDA, cwd: ROOT, timeout: ms, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const saida = String(r.stdout || "");
  const erro = String(r.stderr || "");
  if (r.error) {
    const motivo = /ETIMEDOUT/.test(r.error.code || "") || r.signal === "SIGTERM" ? `timeout de ${Math.round(ms / 1000)}s no CLI` : r.error.message;
    return resposta(false, 500, "", motivo);
  }
  if (r.signal) return resposta(false, 500, saida, `o CLI foi morto por ${r.signal} (timeout de ${Math.round(ms / 1000)}s)`);
  if (r.status !== 0) return resposta(false, /quota|limit exceeded|402|payment|credit|usage/i.test(erro + saida) ? 429 : 500, saida, `saiu com ${r.status}: ${(erro || saida).trim().slice(0, 300)}`);
  if (!saida.trim()) return resposta(false, 500, "", "voltou sem texto nenhum");
  return resposta(true, 200, saida, "");
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

function chamar(p, modelo, prompt, timeoutMs) {
  if (p.tipo === "cli") return Promise.resolve(chamarCli(p, modelo, prompt, timeoutMs));
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

module.exports = { configurados, armados, desarmados, descobrir, chamar, extrair, reason, rotulo, localizar };
