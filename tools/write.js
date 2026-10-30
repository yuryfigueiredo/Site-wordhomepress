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
const PREFERRED = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-2.0-flash"];
const PREFS = [process.env.GEMINI_MODEL, ...PREFERRED].filter(Boolean);
const API = "https://generativelanguage.googleapis.com/v1beta";

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
    signal: AbortSignal.timeout(180000),
  });
}

const DIR = path.join(ROOT, "pipeline", "drafts", SLUG);
const PROMPT = path.join(DIR, "prompt.md");
/* fix.md é o retorno do editor mecânico: quando o check-post reprova, o turno
   grava ali as reprovações e o modelo reescreve obedecendo a elas. */
const FIX = path.join(DIR, "fix.md");

(async () => {
  const available = await modelsForKey();
  let models;
  if (!available || !available.length) {
    if (CHECK_ONLY) { console.error("não deu para saber o que a chave tem — o motivo está acima."); process.exit(1); }
    models = PREFS;
    console.error("a listagem não respondeu; seguindo com a fila fixa de preferidos.");
  } else {
    const preferidos = PREFS.filter((m) => available.includes(m));
    const extras = available.filter((m) => !PREFS.includes(m)).slice(0, 2);
    models = [...preferidos, ...extras];
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

  const falhas = [];
  let lastErr = "";
  /* Teto de parede: sem ele, uma chave sem cota transforma a rodada em uma
     espera de meia hora até o timeout do Actions matar o processo no meio. */
  const DEADLINE = Date.now() + Number(process.env.WRITE_MINUTES || 8) * 60000;
  for (const model of models) {
    if (Date.now() > DEADLINE) { falhas.push(`${model}: desistiu no teto de ${process.env.WRITE_MINUTES || 8}min`); continue; }
    for (let attempt = 1; attempt <= 3; attempt++) {
      let res;
      try {
        res = await call(model, prompt);
      } catch (err) {
        lastErr = `rede: ${err.message}`;
        await sleep(15000 * attempt);
        continue;
      }
      if (res.status === 429 || res.status === 503) {
        /* Cota da free tier: espera e tenta de novo; não é erro de texto. */
        lastErr = `HTTP ${res.status} (cota/indisponível)`;
        await sleep(30000 * attempt);
        continue;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        lastErr = `HTTP ${res.status}: ${reason(txt)}`;
        if (/API_KEY_INVALID/i.test(txt)) {
          console.error(`a chave foi recusada: ${lastErr}`);
          process.exit(1);
        }
        /* Nome inexistente ou sem permissão não melhora com repetição: próximo modelo. */
        if (res.status === 404 || res.status === 403) break;
        await sleep(15000 * attempt);
        continue;
      }

      const json = await res.json();
      const cand = (json.candidates || [])[0] || {};
      if (!cand.content) {
        const blocked = ((json.promptFeedback || {}).blockReason || {}).reason;
        lastErr = `voltou sem texto (${cand.finishReason || blocked || "resposta vazia"})`;
        break;
      }
      const text = (cand.content.parts || []).map((p) => p.text || "").join("");
      const clean = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "").trim();
      let draft;
      try {
        draft = JSON.parse(clean);
      } catch (err) {
        lastErr = `${cand.finishReason === "MAX_TOKENS" ? "texto truncado no limite de tokens; " : ""}resposta não é JSON: ${clean.slice(0, 200)}`;
        continue;
      }
      const missing = ["id", "title", "dek", "content", "sources", "self_check"].filter((k) => draft[k] === undefined);
      if (missing.length) { lastErr = `JSON sem campos: ${missing.join(", ")}`; continue; }
      draft.id = draft.id || SLUG.replace(/_/g, "-");
      fs.writeFileSync(path.join(DIR, "draft.json"), JSON.stringify(draft, null, 2) + "\n");
      console.log(`escrito por ${model}: ${draft.id} (${String(draft.content).split(/\s+/).length} palavras brutas)`);
      console.log("próximo passo: node tools/check-post.js " + SLUG);
      process.exit(0);
    }
    falhas.push(`${model}: ${lastErr}`);
  }
  console.error("não consegui texto do Gemini. O que houve com cada modelo da fila:");
  for (const f of falhas) console.error("  · " + f);
  if (available && available.length) console.error(`modelos que esta chave tem: ${available.slice(0, 40).join(", ")}`);
  console.error("A rodada termina aqui de propósito: sem texto não há o que checar nem publicar.");
  process.exit(1);
})();
