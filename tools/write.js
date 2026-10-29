/* write.js — o redator quando o seu PC está desligado.
   Chama a free tier do Gemini com o prompt.md inteiro (system prompt verbatim
   da redação + brief + memória anti-repetição) e grava draft.json. Não instala
   nada: só fetch do Node. Sem chave, ou sem cota, ele falha ALTO e não publica.

   Uso:
     GEMINI_API_KEY=... node tools/write.js <slug>
   Env opcional: GEMINI_MODEL (padrão gemini-2.5-flash)                       */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SLUG = process.argv[2];
if (!SLUG || !/^[a-z0-9_-]+$/.test(SLUG)) {
  console.error("uso: GEMINI_API_KEY=... node tools/write.js <slug>");
  process.exit(2);
}
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  console.error("GEMINI_API_KEY ausente. Crie uma chave grátis em aistudio.google.com e guarde em Settings → Secrets do repositório.");
  process.exit(2);
}
const MODELS = [process.env.GEMINI_MODEL, "gemini-2.5-flash", "gemini-2.5-flash-lite"].filter(Boolean);

const DIR = path.join(ROOT, "pipeline", "drafts", SLUG);
const PROMPT = path.join(DIR, "prompt.md");
if (!fs.existsSync(PROMPT)) {
  console.error(`não existe ${path.relative(ROOT, PROMPT)} — rode new-post.js antes`);
  process.exit(2);
}
/* fix.md é o retorno do editor mecânico: quando o check-post reprova, o turno
   grava ali as reprovações e o modelo reescreve obedecendo a elas. */
const FIX = path.join(DIR, "fix.md");
const prompt = fs.readFileSync(PROMPT, "utf8") + (fs.existsSync(FIX) ? "\n\n---\n" + fs.readFileSync(FIX, "utf8") : "");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(model) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": KEY },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt + "\n\nResponda SOMENTE com o JSON do output contract. Sem cercas de código, sem comentário." }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.9, maxOutputTokens: 8192 },
    }),
    signal: AbortSignal.timeout(180000),
  });
  return res;
}

(async () => {
  let lastErr = "";
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      let res;
      try {
        res = await call(model);
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
      if (res.status === 404) { lastErr = `modelo ${model} não existe neste tier`; break; }
      if (res.status === 400 || res.status === 403) {
        const body = await res.text();
        console.error(`Gemini recusou (HTTP ${res.status}): ${body.slice(0, 400)}`);
        process.exit(1);
      }
      if (!res.ok) { lastErr = `HTTP ${res.status}`; await sleep(15000 * attempt); continue; }

      const json = await res.json();
      const text = (json.candidates || [{}])[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
      const clean = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "").trim();
      let draft;
      try {
        draft = JSON.parse(clean);
      } catch (err) {
        lastErr = `resposta não é JSON: ${clean.slice(0, 200)}`;
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
  }
  console.error(`não consegui texto do Gemini. Último erro: ${lastErr}`);
  console.error("A rodada termina aqui de propósito: sem texto não há o que checar nem publicar.");
  process.exit(1);
})();
