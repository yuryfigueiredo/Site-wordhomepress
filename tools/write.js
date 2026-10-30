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
  const prompt = fs.readFileSync(PROMPT, "utf8") + (fs.existsSync(FIX) ? "\n\n---\n" + fs.readFileSync(FIX, "utf8") : "");

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
    let draft;
    try {
      draft = JSON.parse(clean);
    } catch {
      falhas.set(k, `resposta não é JSON: ${clean.slice(0, 200)}`);
      return "definitivo";
    }
    const missing = ["id", "title", "dek", "content", "sources", "self_check"].filter((x) => draft[x] === undefined);
    if (missing.length) { falhas.set(k, `JSON sem campos: ${missing.join(", ")}`); return "definitivo"; }
    draft.id = draft.id || SLUG.replace(/_/g, "-");
    fs.writeFileSync(path.join(DIR, "draft.json"), JSON.stringify(draft, null, 2) + "\n");
    console.log(`escrito por ${k}: ${draft.id} (${String(draft.content).split(/\s+/).length} palavras brutas)`);
    console.log("próximo passo: node tools/check-post.js " + SLUG);
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

  /* Fatia justa: o que sobra do teto, dividido entre os provedores que ainda
     não foram tentados. Com um provedor só, ele fica com o orçamento inteiro. */
  for (let i = 0; i < grupos.length; i++) {
    const resto = grupos.length - i;
    const ate = Math.min(fim, Date.now() + Math.max(60000, (fim - Date.now()) / resto));
    await rodar(grupos[i], ate);
  }

  console.error(`não saiu texto em ${MIN}min, em nenhum provedor armado. O que houve:`);
  for (const [k, f] of falhas) console.error(`  · ${k}: ${f}`);
  const sem = prov.desarmados();
  if (sem.length) console.error(`sem chave (não tentados): ${sem.map((p) => `${p.nome} (${p.chave_env})`).join(", ")}`);
  console.error("A rodada termina aqui de propósito: sem texto não há o que checar nem publicar.");
  process.exit(1);
})();
