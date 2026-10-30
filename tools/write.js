/* write.js — o redator quando o seu PC está desligado.
   Chama a free tier do Gemini com o prompt.md inteiro (system prompt verbatim
   da redação + brief + memória anti-repetição) e grava draft.json. Não instala
   nada: só fetch do Node. Sem chave, ou sem cota, ele falha ALTO e não publica.

   Uso:
     GEMINI_API_KEY=... node tools/write.js <slug>
     GEMINI_API_KEY=... node tools/write.js --check   # pergunta o que a chave pode
   Env opcional: GEMINI_MODEL (põe este modelo na frente da fila)             */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SLUG = process.argv[2];
const CHECK_ONLY = SLUG === "--check";
if (!SLUG || !/^[a-z0-9_-]+$/.test(SLUG)) {
  console.error("uso: GEMINI_API_KEY=... node tools/write.js <slug> | --check");
  process.exit(2);
}
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  console.error("GEMINI_API_KEY ausente. Crie uma chave grátis em aistudio.google.com e guarde em Settings → Secrets do repositório.");
  process.exit(2);
}

/* Os nomes de modelo não podem ser chutados aqui: mudam com o tempo e nem todo
   nome existe no tier gratuito desta chave. A fonte da verdade é a própria
   chave — ela devolve a lista do que ela pode usar no generateContent. */
const FALLBACK = ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];
const API = "https://generativelanguage.googleapis.com/v1beta";
const { rank } = require("./lib/rank-models");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function reason(bodyText) {
  try {
    const j = JSON.parse(bodyText);
    return [j.error && j.error.status, j.error && j.error.message].filter(Boolean).join(" · ") || String(bodyText).slice(0, 160);
  } catch {
    return String(bodyText).slice(0, 160);
  }
}

async function modelsForKey() {
  let res;
  try {
    res = await fetch(`${API}/models?pageSize=200`, { headers: { "x-goog-api-key": KEY }, signal: AbortSignal.timeout(30000) });
  } catch (err) {
    console.error(`a listagem de modelos falhou na rede: ${err.message}`);
    return null;
  }
  if (!res.ok) {
    console.error(`esta chave não deixou listar modelos (HTTP ${res.status}): ${reason(await res.text().catch(() => ""))}`);
    return null;
  }
  const json = await res.json().catch(() => null);
  return ((json && json.models) || [])
    .filter((m) => !m.supportedMethods || !m.supportedMethods.length || m.supportedMethods.includes("generateContent"))
    .map((m) => String(m.name || "").replace(/^models\//, ""))
    .filter((n) => n && !/embedding|-image|-tts|-live|computer-use|aqa/i.test(n));
}

async function call(model, prompt) {
  return fetch(`${API}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": KEY },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt + "\n\nResponda SOMENTE com o JSON do output contract. Sem cercas de código, sem comentário." }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.9, maxOutputTokens: 8192 },
    }),
    signal: AbortSignal.timeout(240000),
  });
}

const DIR = path.join(ROOT, "pipeline", "drafts", SLUG);
const PROMPT = path.join(DIR, "prompt.md");
/* fix.md é o retorno do editor mecânico: quando o check-post reprova, o turno
   grava ali as reprovações e o modelo reescreve obedecendo a elas. */
const FIX = path.join(DIR, "fix.md");

(async () => {
  const available = await modelsForKey();
  const forcar = process.env.GEMINI_MODEL;
  let models;
  if (!available || !available.length) {
    if (CHECK_ONLY) { console.error("não deu para saber o que a chave tem — o motivo está acima."); process.exit(1); }
    models = [forcar, ...FALLBACK].filter(Boolean);
    console.error("a listagem não respondeu; seguindo com a fila de reserva.");
  } else {
    const ordenado = rank(available);
    models = [forcar, ...ordenado.filter((m) => m !== forcar)].filter(Boolean).slice(0, 4);
    if (CHECK_ONLY) {
      console.log(`modelos desta chave que escrevem texto: ${available.length}`);
      console.log(available.join("\n"));
      console.log(`\na fila que o redator usaria: ${models.join(", ") || "nenhuma"}`);
      process.exit(0);
    }
    if (!models.length) {
      console.error(`esta chave não tem modelo de texto na fila. Ela tem: ${available.join(", ").slice(0, 700)}`);
      process.exit(1);
    }
  }

  if (!fs.existsSync(PROMPT)) {
    console.error(`não existe ${path.relative(ROOT, PROMPT)} — rode new-post.js antes`);
    process.exit(2);
  }
  const prompt = fs.readFileSync(PROMPT, "utf8") + (fs.existsSync(FIX) ? "\n\n---\n" + fs.readFileSync(FIX, "utf8") : "");

  const falhas = new Map();
  /* Teto de parede: sem ele, uma chave sem cota transforma a rodada em uma
     espera de meia hora até o timeout do Actions matar o processo no meio. */
  const MIN = Number(process.env.WRITE_MINUTES || 6);
  const inicio = Date.now();
  const restante = () => MIN * 60000 - (Date.now() - inicio);
  const fila = [...models];
  const tentado = new Set();

  /* Uma passada por modelo. "transitorio" (503, 429, rede) é o único caso em
     que esperar resolve; "definitivo" (nome morto, JSON ruim) pede outro modelo. */
  async function tentar(model) {
    const registro = (msg) => falhas.set(model, msg);
    let res;
    try {
      res = await call(model, prompt);
    } catch (err) {
      registro(`rede: ${err.message}`);
      return "transitorio";
    }
    if (res.status === 429) { registro("HTTP 429 (cota do tier)"); return "transitorio"; }
    if (res.status === 503 || res.status === 500 || res.status === 502) {
      const txt = await res.text().catch(() => "");
      registro(`HTTP ${res.status}: ${reason(txt) || "serviço ocupado"}`);
      return "transitorio";
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      registro(`HTTP ${res.status}: ${reason(txt)}`);
      if (/API_KEY_INVALID|api key not valid/i.test(txt)) {
        console.error(`a chave foi recusada: ${falhas.get(model)}`);
        process.exit(1);
      }
      /* A própria API diz qual modelo usar no lugar; seguir a dica é o que
         mantém a automação viva quando um nome é aposentado. */
      const dica = (txt.match(/use\s+models\/([a-z0-9.\-]+)/i) || [])[1];
      if (dica && !fila.includes(dica)) fila.push(dica);
      return "definitivo";
    }

    const json = await res.json();
    const cand = (json.candidates || [])[0] || {};
    if (!cand.content) {
      const blocked = ((json.promptFeedback || {}).blockReason || {}).reason;
      registro(`voltou sem texto (${cand.finishReason || blocked || "resposta vazia"})`);
      return "definitivo";
    }
    const text = (cand.content.parts || []).map((p) => p.text || "").join("");
    const clean = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "").trim();
    let draft;
    try {
      draft = JSON.parse(clean);
    } catch (err) {
      registro(`${cand.finishReason === "MAX_TOKENS" ? "texto truncado no limite de tokens; " : ""}resposta não é JSON: ${clean.slice(0, 200)}`);
      return "definitivo";
    }
    const missing = ["id", "title", "dek", "content", "sources", "self_check"].filter((k) => draft[k] === undefined);
    if (missing.length) { registro(`JSON sem campos: ${missing.join(", ")}`); return "definitivo"; }
    draft.id = draft.id || SLUG.replace(/_/g, "-");
    fs.writeFileSync(path.join(DIR, "draft.json"), JSON.stringify(draft, null, 2) + "\n");
    console.log(`escrito por ${model}: ${draft.id} (${String(draft.content).split(/\s+/).length} palavras brutas)`);
    console.log("próximo passo: node tools/check-post.js " + SLUG);
    process.exit(0);
  }

  /* Varre a fila inteira primeiro: custa segundos e separa "nome morto" de
     "serviço sobrecarregado". Só no segundo caso vale dormir e voltar — é o
     único erro que passa sozinho. */
  let espera = 30000;
  for (;;) {
    let transitorios = 0;
    for (const model of [...fila]) {
      if (tentado.has(model)) continue;
      if (restante() < 20000) break;
      tentado.add(model);
      if ((await tentar(model)) === "transitorio") transitorios++;
    }
    if (!transitorios || restante() < espera + 20000) break;
    console.error(`${transitorios} modelo(s) responderam ocupado; esperando ${Math.round(espera / 1000)}s e tentando de novo (${Math.round(restante() / 1000)}s de orçamento).`);
    await sleep(espera);
    espera = Math.min(espera * 2, 120000);
    for (const m of [...tentado]) if (/ocupado|429|rede/.test(falhas.get(m) || "")) tentado.delete(m);
  }
  console.error(`não consegui texto do Gemini em ${MIN}min de tentativas. O que houve com cada modelo:`);
  for (const [m, f] of falhas) console.error(`  · ${m}: ${f}`);
  if (available && available.length) console.error(`modelos que esta chave tem: ${available.slice(0, 40).join(", ")}`);
  console.error("A rodada termina aqui de propósito: sem texto não há o que checar nem publicar.");
  process.exit(1);
})();
