/* teste-reentrada-veredito.js — quem volta para a fila é o VEREDITO da chamada,
   não a palavra que saiu no diário.

   O defeito (apontado pelo revisor de doutrina em 15/11 e confirmado aqui por
   medida): `rodar()` já recebia de `tentar()` a resposta estruturada
   ("transitorio" | "definitivo") e mesmo assim, na hora de decidir quais modelos
   re-entravam, relia o MAPA DE RÓTULOS com `/ocupado|429|rede/`. Duas
   implementações da mesma régua, como `[cover]` e o piso de palavras: uma decide
   e a outra, escrita para o olho humano, executa. Os dois sentidos do erro:

     · um `definitivo` cujo texto cita «rede» — «resposta não é JSON: A rede
       social citada na matéria», caso banal em português — voltava para a fila e
       pagava a escada de 15→30→90 s numa chamada que o próprio módulo já tinha
       condenado;
     · um `transitorio` legítimo de HTTP 500 com corpo «upstream busy» NUNCA
       voltava: a passada dormia, contava o modelo como ocupado e devolvia sem
       segunda tentativa — contra o que tools/AUTOMATION.md jura (503/429 é
       tentado de novo).

   A correção é uma boca só: a lista `ocupados` da passada é construída com o
   veredito que `tentar()` acabou de devolver, e é ela que re-entra. Como a lista
   é por passada, uma tentativa velha também não fica reentrando para sempre.

   Roda em CÓPIA do repo, com um servidor HTTP de fixture em porta efêmera que
   responde por nome de modelo. Nenhuma chave real, nenhuma cota, nenhum minuto do
   plano do app: o `qodercli` nunca é levantado aqui.                                */
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SLUG = "fixture-reentrada-veredito";
const ALVO = 1100;

let verde = 0;
const falhas = [];
function confere(nome, ok, dado) {
  if (ok) {
    verde++;
    console.log(`  ✓ ${nome}`);
  } else {
    falhas.push(nome);
    console.log(`  ✗ ${nome}${dado === undefined ? "" : " :: " + String(dado).slice(0, 500)}`);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hwp-reentrada-"));
const chamadas = new Map();

/* Quatro comportamentos, dois por veredito. Os nomes são deliberadamente
   desalinhados dos rótulos que o diário vai imprimir: é exatamente esse
   desalinhamento que a regex lia como régua.                                    */
const MODELOS = {
  /* transitorio SEM as palavras mágicas no rótulo (sai «HTTP 500: upstream busy») */
  "afogado-busy": (res) => { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: "upstream busy" } })); },
  /* transitorio COM a palavra clássica — o caso que sempre funcionou */
  "servico-ocupado": (res) => { res.writeHead(503, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: "serviço ocupado" } })); },
  /* definitivo cujo texto contém a palavra «rede» — a isca da regex velha */
  "prosa-com-rede": (res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ choices: [{ message: { content: "A rede social citada na matéria deveria estar num parágrafo" } }] })); },
  /* definitivo sem palavra nenhuma: não volta em nenhuma das duas versões */
  "sem-campos": (res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ choices: [{ message: { content: '{"id":"x"}' } }] })); },
};

const server = http.createServer((req, res) => {
  let bruto = "";
  req.on("data", (c) => (bruto += c));
  req.on("end", () => {
    if (req.method === "GET") {
      /* `descobrir()` do providers.js lista antes de escrever; sem esta boca o
         provedor cai na fila de reserva E no cap de `modelos_por_rodada`, e a
         prova mediria dois modelos em vez de quatro. */
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: Object.keys(MODELOS).map((id) => ({ id })) }));
      return;
    }
    let modelo = "?";
    try { modelo = JSON.parse(bruto).model; } catch {}
    chamadas.set(modelo, (chamadas.get(modelo) || 0) + 1);
    const trata = MODELOS[modelo];
    if (!trata) { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: "modelo de fixture inexistente" } })); return; }
    trata(res);
  });
});

function copia(provedores, mut) {
  const dir = fs.mkdtempSync(path.join(tmp, "copia-")) + "/repo";
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  spawnSync("cp", ["-a", `${ROOT}/.`, `${dir}/`], { stdio: "ignore" });
  fs.writeFileSync(path.join(dir, "pipeline", "providers.json"), JSON.stringify({ provedores }, null, 2) + "\n");
  const d = path.join(dir, "pipeline", "drafts", SLUG);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "prompt.md"), "CONTRATO DE FIXTURE: escreva a matéria em JSON puro.\n");
  fs.writeFileSync(path.join(d, "brief.json"), JSON.stringify({ word_count: ALVO, sources: [{ name: "Fixture Daily", url: "https://fixture.example" }] }, null, 2) + "\n");
  if (mut) {
    const arq = path.join(dir, "tools", "write.js");
    const fonte = fs.readFileSync(arq, "utf8");
    const nova = mut(fonte);
    if (nova === fonte) throw new Error("a mutação não encontrou o token em tools/write.js");
    fs.writeFileSync(arq, nova);
  }
  return dir;
}

/* `spawn`, nunca `spawnSync`: o servidor de fixture vive NESTE processo, e um
   filho síncrono congela a loop do pai — o fetch do redator ficaria mudo até o
   AbortSignal de 20 s e a prova mediria «empacou» em vez do veredito (medido
   15/11: HITS [] com spawnSync).                                                 */
function roda(dir) {
  return new Promise((resolve) => {
    const filho = spawn(process.execPath, [path.join(dir, "tools", "write.js"), SLUG], {
      cwd: dir,
      env: { ...process.env, HWP_FIXTURE_KEY: "chave-de-fixture", WRITE_MINUTES: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    filho.stdout.on("data", (c) => (out += c));
    filho.stderr.on("data", (c) => (err += c));
    const parede = setTimeout(() => filho.kill("SIGKILL"), 240000);
    filho.on("exit", (code) => {
      clearTimeout(parede);
      resolve({ code: code ?? -1, out, err });
    });
  });
}

const PROVEDOR = {
  nome: "fixture",
  tipo: "openai",
  ativo: true,
  endpoint: "http://127.0.0.1:0/v1",
  chave_env: "HWP_FIXTURE_KEY",
  fila: Object.keys(MODELOS),
  /* Sem isto, `descobrir()` corta a fila no cap padrão de 2 e a prova mediria
     metade dos vereditos, passando verde por ignorância da fila.               */
  modelos_por_rodada: Object.keys(MODELOS).length,
  peso: 1,
};

async function main() {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  /* Retrato da árvore ANTES: o que estiver sujo aqui é de outra mão (a desta
     prova são os dois fixes que ela confere), e a régua é nada MUDAR.          */
  const retrato = () => ({
    git: spawnSync("git", ["-C", ROOT, "status", "--porcelain", "-uno"], { encoding: "utf8" }).stdout,
    rascunhos: fs.readdirSync(path.join(ROOT, "pipeline", "drafts")).sort().join("\n"),
  });
  const antes = retrato();

  console.log("\n1. a decisão de re-entrada tem UMA boca: o rótulo não é lido como régua");
  {
    const w = fs.readFileSync(path.join(ROOT, "tools", "write.js"), "utf8");
    confere("write.js não guarda mais a regex de rótulos", !w.includes("/ocupado|429|rede/"), "ainda há /ocupado|429|rede/ em tools/write.js");
    confere("quem re-entra é a lista da passada, construída pelo veredito", /const ocupados = \[\];/.test(w) && /ocupados\.push\(modelo\)/.test(w) && /for \(const m of ocupados\) grupo\.tentado\.delete\(m\);/.test(w));
    confere("nenhum outro lugar do repo decide re-entrada por palavra", (() => {
      const achados = spawnSync("grep", ["-rn", "-F", "ocupado|429|rede", path.join(ROOT, "tools")], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean);
      return achados.length === 0;
    })(), spawnSync("grep", ["-rn", "-F", "ocupado|429|rede", path.join(ROOT, "tools")], { encoding: "utf8" }).stdout.trim().slice(0, 300));
  }

  console.log("\n2. o veredito manda: HTTP 500 «upstream busy» volta, prosa com «rede» não volta");
  let rodou = null;
  {
    const p = { ...PROVEDOR, endpoint };
    const dir = copia([p]);
    rodou = await roda(dir);
    const n = (m) => chamadas.get(m) || 0;
    console.log(`    chamadas por modelo: ${Object.keys(MODELOS).map((m) => `${m}=${n(m)}`).join(" · ")} · exit ${rodou.code}`);
    confere("a primeira passada varreu os QUATRO modelos (a fila não foi cortada no cap)", Object.keys(MODELOS).every((m) => n(m) >= 1), Object.keys(MODELOS).map((m) => `${m}=${n(m)}`).join(" · "));
    confere("transitorio sem as palavras mágicas É re-entrado (a doc jura 503/429)", n("afogado-busy") >= 2, `veio ${n("afogado-busy")} chamada(s) — o modelo ocupado morreu na primeira tentativa`);
    confere("definitivo cujo texto cita «rede» NÃO re-entra", n("prosa-com-rede") === 1, `veio ${n("prosa-com-rede")} chamada(s)`);
    confere("o clássico 503 «serviço ocupado» continua re-entrando", n("servico-ocupado") >= 2, `veio ${n("servico-ocupado")} chamada(s)`);
    confere("definitivo sem palavra nenhuma fica fora da fila", n("sem-campos") === 1, `veio ${n("sem-campos")} chamada(s)`);
    confere("a linha do diário conta os VERDADEIROS ocupados, não as palavras do rótulo", /: 2 modelo\(s\) ocupado\(s\)/.test(rodou.err), (rodou.err.match(/.*modelo\(s\) ocupado\(s\).*/g) || ["sem linha de espera"]).join(" ⏎ ").slice(0, 300));
    confere("e nenhum texto de fixture virou rascunho no disco", !fs.existsSync(path.join(dir, "pipeline", "drafts", SLUG, "draft.json")));
  }

  console.log("\n3. falsificação: voltar a ler o rótulo devolve os dois erros");
  {
    chamadas.clear();
    const p = { ...PROVEDOR, endpoint };
    const dir = copia([p], (fonte) =>
      fonte.replace(
        "for (const m of ocupados) grupo.tentado.delete(m);",
        'for (const m of [...grupo.tentado]) if (/ocupado|429|rede/.test(falhas.get(grupo.p.nome + "/" + m) || "")) grupo.tentado.delete(m);'
      )
    );
    const w = fs.readFileSync(path.join(dir, "tools", "write.js"), "utf8");
    confere("a mutação encontrou a boca da re-entrada", w.includes('if (/ocupado|429|rede/.test(falhas.get('), "o token da re-entrada mudou de forma — atualizar a mutação");
    await roda(dir);
    const n = (m) => chamadas.get(m) || 0;
    console.log(`    chamadas com a regex no lugar: ${Object.keys(MODELOS).map((m) => `${m}=${n(m)}`).join(" · ")}`);
    confere("com a regex, o 500 «upstream busy» fica enterrado na primeira tentativa", n("afogado-busy") === 1, `veio ${n("afogado-busy")} chamada(s)`);
    confere("com a regex, a prosa com «rede» paga a escada de espera", n("prosa-com-rede") >= 2, `veio ${n("prosa-com-rede")} chamada(s)`);
  }

  console.log("\n4. o diário da reescrita cirúrgica usa o MESMO veredito de transporte");
  {
    /* O ramo de edits não decide re-entrada (a chave tem o sufixo /patch e não
       está em `grupo.tentado`), mas era a única boca que rotulava QUALQUER
       exceção de `rede:` — a forma exata do defeito que a recusa de conexão
       matou no laço principal. Aqui o que se confere é a palavra no stderr.   */
    const w = fs.readFileSync(path.join(ROOT, "tools", "write.js"), "utf8");
    const bloco = w.slice(w.indexOf("const caiFora = (motivo)"), w.indexOf("if (res) {"));
    confere("o catch cirúrgico chama transporte.classe()", /transporte\.classe\(err\)/.test(bloco), bloco.trim().slice(0, 260));
    confere("e não escreve mais `rede:` para todo erro igual", !/caiFora\(`rede: \$\{err\.message\}`\)/.test(bloco), "ainda há um caiFora(`rede:`) incondicional");
  }

  console.log("\n5. invariante: a máquina do dono não foi tocada");
  {
    const depois = retrato();
    confere("nenhum rascunho de fixture entrou no pipeline/drafts real", !fs.existsSync(path.join(ROOT, "pipeline", "drafts", SLUG)));
    confere("nenhum fixture escreveu no providers.json real", !fs.readFileSync(path.join(ROOT, "pipeline", "providers.json"), "utf8").includes("127.0.0.1"), "apareceu endpoint de fixture");
    confere("o git status da árvore é o mesmo de antes desta prova", depois.git === antes.git, `antes [${antes.git.split("\n").join(" ⏎ ")}] → depois [${depois.git.split("\n").join(" ⏎ ")}]`);
    confere("nem um rejeitado-*.txt novo apareceu nos rascunhos reais", depois.rascunhos === antes.rascunhos, `antes ${antes.rascunhos.split("\n").length} entradas → depois ${depois.rascunhos.split("\n").length}`);
  }

  server.close();
  for (const sobra of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, sobra), { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  confere("nenhuma cópia desta prova ficou no /tmp", !fs.existsSync(tmp), path.basename(tmp));
  console.log(`\n${verde} conferências verdes, ${falhas.length} vermelhas${falhas.length ? ": " + falhas.join(" | ") : ""}.`);
  process.exit(falhas.length ? 1 : 0);
}

main().catch((e) => {
  console.error(`teste-reentrada-veredito estourou: ${e && e.stack ? e.stack : e}`);
  try { server.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
