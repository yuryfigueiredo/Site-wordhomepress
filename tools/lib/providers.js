/* providers.js — quem pode escrever o texto e em que ordem.
   A ordem e os endpoints moram em pipeline/providers.json. A chave, não: o
   JSON diz o NOME da variável de ambiente, e o provedor só entra na fila se
   essa variável existir. Provedor armado mas fora do ar é pulado; provedor
   sem chave é ignorado em silêncio (é o estado normal de quem ainda não criou
   a conta lá).

   Dois tipos bastam:
     gemini  — API própria do Google (descoberta + generateContent)
     openai  — qualquer endpoint compatível com /chat/completions          */
const fs = require("fs");
const path = require("path");
const { rank, diversificar } = require("./rank-models");

const ROOT = path.resolve(__dirname, "..", "..");
const CONFIG = path.join(ROOT, "pipeline", "providers.json");

const NAO_ESCREVE = /embed|whisper|tts|guard|rerank|moderation|audio|image|vision|ocr|diffusion|transcribe/i;

function configurados() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch (err) {
    console.error(`pipeline/providers.json ilegível: ${err.message}`);
    return [];
  }
  return ((raw && raw.provedores) || []).filter((p) => p && p.ativo !== false && p.nome && p.chave_env && p.endpoint);
}

const armados = () => configurados().map((p) => ({ ...p, chave: process.env[p.chave_env] })).filter((p) => p.chave);
const desarmados = () => configurados().filter((p) => !process.env[p.chave_env]);

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

function chamar(p, modelo, prompt, timeoutMs) {
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

module.exports = { configurados, armados, desarmados, descobrir, chamar, extrair, reason };
