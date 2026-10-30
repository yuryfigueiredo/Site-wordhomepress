/* write.js — o redator quando o seu PC está desligado.
   Chama o prompt.md inteiro (system prompt verbatim da redação + brief + memória
   anti-repetição) e grava draft.json. Não instala nada: só fetch do Node.

   Os provedores e a ordem em que são tentados estão em pipeline/providers.json.
   Só entra na fila quem tem a chave no ambiente; o resto é pulado sem erro.
   Sem nenhum provedor armado, ou sem texto de nenhum deles, ele falha ALTO e
   não publica.

   Uso:
     GEMINI_API_KEY=... node tools/write.js <slug>
     node tools/write.js --check   # mostra quem está armado e o que cada um tem
   Env opcional: WRITE_MINUTES (teto de parede, padrão 6)                        */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SLUG = process.argv[2];
const CHECK_ONLY = SLUG === "--check";
if (!SLUG || (!CHECK_ONLY && !/^[a-z0-9_-]+$/.test(SLUG))) {
  console.error("uso: node tools/write.js <slug> | --check");
  process.exit(2);
}

const prov = require("./lib/providers");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DIR = path.join(ROOT, "pipeline", "drafts", SLUG);
const PROMPT = path.join(DIR, "prompt.md");
/* fix.md é o retorno do editor mecânico: quando o check-post reprova, o turno
   grava ali as reprovações e o modelo reescreve obedecendo a elas. */
const FIX = path.join(DIR, "fix.md");

const falhas = new Map();
const contar = (html) => String(html || "").replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
const alvo = (() => {
  try { return Number(JSON.parse(fs.readFileSync(path.join(DIR, "brief.json"), "utf8")).word_count || 0); } catch { return 0; }
})();
const piso = alvo ? Math.round(alvo * 0.7) : 0;
/* Plano B do comprimento: se nenhum modelo bate o piso, fica gravado o mais
   longo, para a reescrita expandir em vez de começar do zero outra vez. */
let melhor = null;

function gravar(draft, k) {
  draft.id = draft.id || SLUG.replace(/_/g, "-");
  /* Modelo às vezes devolve sources vazio mesmo tendo recebido a pauta; a
     matéria ia ao ar sem nenhuma citação. A fonte do brief é verificada, então
     ela entra como fonte mínima. */
  if (!Array.isArray(draft.sources) || !draft.sources.length) {
    try {
      const bs = JSON.parse(fs.readFileSync(path.join(DIR, "brief.json"), "utf8")).sources || [];
      if (bs.length) draft.sources = bs.map((s) => ({ ...s, claim: s.claim || "pauta original da rodada" }));
    } catch {}
  }
  /* A reescrita não deve perder a capa: o modelo nunca vê o arquivo gerado
     por make-cover.js e devolve image null. */
  if (!draft.image) {
    try {
      const ant = JSON.parse(fs.readFileSync(path.join(DIR, "draft.json"), "utf8"));
      if (ant.image) { draft.image = ant.image; draft.imageAlt = draft.imageAlt || ant.imageAlt; }
    } catch {}
  }
  fs.writeFileSync(path.join(DIR, "draft.json"), JSON.stringify(draft, null, 2) + "\n");
  console.log(`escrito por ${k}: ${draft.id} (${contar(draft.content)} palavras)`);
  console.log("próximo passo: node tools/check-post.js " + SLUG);
}

(async () => {
  const armados = prov.armados();

  if (CHECK_ONLY) {
    const sem = prov.desarmados();
    console.log(`armados (chave no ambiente): ${armados.map((p) => p.nome).join(", ") || "nenhum"}`);
    console.log(`sem chave, inertes: ${sem.map((p) => `${p.nome} (${p.chave_env})`).join(", ") || "nenhum"}`);
    for (const p of armados) {
      const d = await prov.descobrir(p);
      console.log(`\n${p.nome}: ${d.modelos.length ? d.modelos.join(", ") : "— não achei modelo de texto"}`);
      if (d.erro) console.log(`  ${d.erro}`);
    }
    process.exit(0);
  }

  if (!armados.length) {
    console.error("nenhum provedor armado: nenhuma das chaves de pipeline/providers.json está no ambiente.");
    console.error(`no Actions, guarde uma destas em Settings → Secrets: ${prov.configurados().map((p) => p.chave_env).join(", ")}`);
    process.exit(2);
  }
  if (!fs.existsSync(PROMPT)) {
    console.error(`não existe ${path.relative(ROOT, PROMPT)} — rode new-post.js antes`);
    process.exit(2);
  }
  const promptBase = fs.readFileSync(PROMPT, "utf8");
  const fixTxt = fs.existsSync(FIX) ? fs.readFileSync(FIX, "utf8") : "";
  let anterior = null;
  try { anterior = JSON.parse(fs.readFileSync(path.join(DIR, "draft.json"), "utf8")); } catch {}

  /* Na reescrita o modelo não estava vendo o que já tinha escrito: recomeçava
     do zero e devolvia ainda menos palavras. O texto atual vai no prompt e a
     ordem é expandir, não reescrever. */
  let prompt = promptBase;
  if (fixTxt) {
    prompt += "\n\n---\n" + fixTxt;
    if (anterior && anterior.content) {
      const n = contar(anterior.content);
      prompt +=
        `\n\n=== SEU TEXTO ATUAL (${n} palavras; o piso é ${piso}) ===\n` +
        JSON.stringify({ title: anterior.title, dek: anterior.dek, sources: anterior.sources, content: anterior.content }, null, 2) +
        `\n\nNÃO reescreva do zero. Mantenha os parágrafos que o editor não reprovou e ACRESCENTE seções até passar de ${piso} palavras. O JSON devolvido tem de conter esse texto expandido.`;
    }
  }

  /* Cada provedor vira um grupo com a sua própria fila de modelos. Só entram
     no jogo os que responderam que têm modelo de texto. */
  const grupos = [];
  for (const p of armados) {
    const d = await prov.descobrir(p);
    if (!d.modelos.length) { falhas.set(p.nome, d.erro || "nenhum modelo de texto"); continue; }
    if (d.erro) console.error(`${p.nome}: ${d.erro}`);
    grupos.push({ p, fila: d.modelos.slice(), tentado: new Set() });
  }
  if (!grupos.length) {
    console.error("nenhum provedor armado tem modelo de texto utilizável:");
    for (const [k, f] of falhas) console.error(`  · ${k}: ${f}`);
    process.exit(1);
  }

  /* Teto de parede: sem ele, uma chave sem cota transforma a rodada em uma
     espera até o timeout do Actions matar o processo no meio. */
  const MIN = Number(process.env.WRITE_MINUTES || 6);
  const fim = Date.now() + MIN * 60000;

  /* Uma passada por modelo. "transitorio" (503, 429, rede) é o único caso em
     que esperar resolve; "definitivo" (nome morto, JSON ruim, chave recusada)
     pede outro modelo — ou outro provedor. */
  async function tentar(grupo, modelo, prazo) {
    const k = `${grupo.p.nome}/${modelo}`;
    let res;
    try {
      /* Com modelos ainda não tentados na fila, um modelo pendurado não pode
         comer a fatia inteira: 2 min é o teto por chamada nesse caso. */
      const frescos = grupo.fila.filter((m) => !grupo.tentado.has(m)).length;
      res = await prov.chamar(grupo.p, modelo, prompt, Math.min(prazo - Date.now(), frescos ? 120000 : 240000));
    } catch (err) {
      falhas.set(k, `rede: ${err.message}`);
      return "transitorio";
    }
    if (res.status === 429) { falhas.set(k, "HTTP 429 (cota do tier)"); return "transitorio"; }
    if (res.status >= 500) {
      const txt = await res.text().catch(() => "");
      falhas.set(k, `HTTP ${res.status}: ${prov.reason(txt) || "serviço ocupado"}`);
      return "transitorio";
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      falhas.set(k, `HTTP ${res.status}: ${prov.reason(txt)}`);
      /* A própria API do Google diz qual modelo usar no lugar; seguir a dica é
         o que mantém a fila viva quando um nome é aposentado. */
      const dica = (txt.match(/use\s+models\/([a-z0-9.\-]+)/i) || [])[1];
      if (dica && !grupo.fila.includes(dica)) grupo.fila.push(dica);
      return "definitivo";
    }

    const lido = prov.extrair(grupo.p, await res.json().catch(() => null));
    if (!lido.texto) { falhas.set(k, lido.motivo); return "definitivo"; }
    const clean = lido.texto.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "").trim();
    /* Resposta rejeitada fica no rascunho para diagnóstico: sem isso, "JSON sem
       campos" é um mistério e a única saída é adivinhar o prompt. */
    const guardar = () => {
      try { fs.writeFileSync(path.join(DIR, `rejeitado-${k.replace(/[^a-z0-9]+/gi, "-")}.txt`), lido.texto); } catch {}
    };
    let draft;
    try {
      draft = JSON.parse(clean);
    } catch {
      falhas.set(k, `resposta não é JSON: ${clean.slice(0, 200)}`);
      guardar();
      return "definitivo";
    }
    const missing = ["id", "title", "dek", "content", "sources", "self_check"].filter((x) => draft[x] === undefined);
    if (missing.length) {
      falhas.set(k, `JSON sem campos: ${missing.join(", ")} (resposta em rejeitado-*.txt)`);
      guardar();
      return "definitivo";
    }
    draft.id = draft.id || SLUG.replace(/_/g, "-");
    const palavras = contar(draft.content);
    /* Texto abaixo do piso não é publicável, e o modelo anterior já ignorou a
       instrução: antes de aceitar, tenta o próximo modelo da fila. */
    if (piso && palavras < piso) {
      falhas.set(k, `curto: ${palavras} palavras (piso ${piso})`);
      if (!melhor || palavras > melhor.palavras) melhor = { draft, palavras, k };
      guardar();
      return "definitivo";
    }
    gravar(draft, k);
    process.exit(0);
  }

  /* Varre a fila de um provedor antes de dormir: custa segundos e separa "nome
     morto" de "serviço sobrecarregado". Só no segundo caso vale esperar. */
  async function rodar(grupo, ate) {
    let espera = 15000;
    for (;;) {
      let transitorios = 0;
      for (const modelo of [...grupo.fila]) {
        if (grupo.tentado.has(modelo)) continue;
        if (ate - Date.now() < 15000) break;
        grupo.tentado.add(modelo);
        if ((await tentar(grupo, modelo, ate)) === "transitorio") transitorios++;
      }
      if (!transitorios || ate - Date.now() < espera + 15000) return;
      console.error(`${grupo.p.nome}: ${transitorios} modelo(s) ocupado(s); esperando ${Math.round(espera / 1000)}s e voltando (${Math.round((ate - Date.now()) / 1000)}s nesta fatia).`);
      await sleep(Math.min(espera, Math.max(0, ate - Date.now() - 15000)));
      espera = Math.min(espera * 2, 90000);
      for (const m of [...grupo.tentado]) if (/ocupado|429|rede/.test(falhas.get(`${grupo.p.nome}/${m}`) || "")) grupo.tentado.delete(m);
    }
  }

  /* Fatia proporcional ao peso declarado em providers.json: o provedor que
     escreve melhor fica com mais tempo. O que sobra sempre vai para o último,
     então nenhum minuto se perde. */
  for (let i = 0; i < grupos.length; i++) {
    const restantes = grupos.slice(i);
    const soma = restantes.reduce((s, g) => s + Number(g.p.peso || 1), 0);
    const fatia = ((fim - Date.now()) * Number(grupos[i].p.peso || 1)) / soma;
    const ate = Math.min(fim, Date.now() + Math.max(60000, fatia));
    await rodar(grupos[i], ate);
  }

  if (melhor) {
    gravar(melhor.draft, melhor.k);
    console.error(`nenhum modelo bateu o piso; guardei o mais longo: ${melhor.palavras} palavras (piso ${piso}). O editor vai reprovar o tamanho e a próxima tentativa expande.`);
    process.exit(0);
  }

  console.error(`não saiu texto em ${MIN}min, em nenhum provedor armado. O que houve:`);
  for (const [k, f] of falhas) console.error(`  · ${k}: ${f}`);
  const sem = prov.desarmados();
  if (sem.length) console.error(`sem chave (não tentados): ${sem.map((p) => `${p.nome} (${p.chave_env})`).join(", ")}`);
  console.error("A rodada termina aqui de propósito: sem texto não há o que checar nem publicar.");
  process.exit(1);
})();
