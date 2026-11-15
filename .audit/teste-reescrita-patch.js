/* teste-reescrita-patch.js — a devolutiva que muda uma linha custa uma linha.

   O defeito, medido na rodada das 06:23 de 15/11: o texto saiu com 1044 palavras,
   o editor reprovou UMA frase de 35 palavras, e o contrato do `fix.md` mandava
   "devolva o JSON completo de novo". A chamada de conserto tinha de reimprimir a
   matéria inteira para trocar doze palavras — e a parede do `write.js` é contada
   em tokens de saída. Foi exatamente essa reescrita que estourou os 780 s das
   02:23 e devolveu uma rodada sem peça, com a pauta queimada.

   Desde agora, quando o texto já passou do piso, o `write.js` pede primeiro
   {"edits":[{"old","new"}]} e aplica a troca no rascunho do disco. Este arquivo
   confere três coisas:
   · a troca cirúrgica é aplicada, e só ela — o resto do texto, o id e a capa
     sobrevivem byte a byte;
   · `old` ambíguo, inexistente, resposta fora do contrato, HTTP errado ou
     troca que derrubaria o piso NADA aplicam e caem no caminho velho, com o
     texto inteiro no prompt: o fallback não pode custar a peça;
   · as duas janelas em que o patch não entra — texto abaixo do piso (lá a
     ordem é ACRESCENTE, e aí ele precisa mesmo ser inteiro) e parede curta.

   Tudo roda em CÓPIA do repo no /tmp com um redator de casca: um script que
   engole o prompt pelo stdin, grava-o numerado e devolve o corpo que o caso
   plantou. Nenhuma rede, nenhum plano do app, nenhum minuto de redator gasto. */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SLUG = "fixture-reescrita-patch";
const ALVO = 1100;
const PISO = require(path.join(ROOT, "tools/lib/word-floor")).piso(ALVO);

let verde = 0;
const falhas = [];
function confere(nome, ok, dado) {
  if (ok) {
    verde++;
    console.log(`  ✓ ${nome}`);
  } else {
    falhas.push(nome);
    console.log(`  ✗ ${nome}${dado === undefined ? "" : " :: " + String(dado).slice(0, 400)}`);
  }
}

const gitAntes = execFileSync("git", ["-C", ROOT, "status", "--porcelain", "-uno"], { encoding: "utf8" });
const memRealAntes = fs.readFileSync(path.join(ROOT, "pipeline/memory.json"), "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hwp-patch-"));

/* A casca: contador de chamada no disco, prompt numerado, corpo pré-plantado.
   `HWP_CASCA_MORRE=N` faz a N-ésima chamada sair 1 com "quota exceeded", que é
   o caminho do 429 — o caso em que o patch erra e a rodada ainda tem de sair. */
const CASCA = path.join(tmp, "redator.sh");
fs.writeFileSync(
  CASCA,
  `#!/bin/bash
n=$(cat "$HWP_CONT" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$HWP_CONT"
cat > "$HWP_CAP-$n"
if [ "$n" = "$HWP_CASCA_MORRE" ]; then echo "quota exceeded" >&2; exit 1; fi
f="$HWP_RES-$n"; [ -f "$f" ] || f="$HWP_RES-default"
cat "$f"
`,
  { mode: 0o755 }
);

/* O corpo do rascunho: 18 palavras fixas + N de enchimento, contadas do mesmo
   jeito do `contar` do write.js (tags viram espaço). Os três parágrafos fixos
   têm papéis: Alpha é o que NÃO pode mudar, Beta é o alvo da troca, Gamma é o
   trecho que se repete — a armadilha da unicidade. */
const ALPHA = "<p>Alpha abre a matéria com uma frase comum.</p>";
const BETA = "<p>Beta beta beta cauda-única-de-teste.</p>";
const GAMMA = "<p>Gamma fragmento repetível. Gamma fragmento repetível.</p>";
const corpo = (enchimento) => `${ALPHA}${BETA}${GAMMA}<p>${"x ".repeat(enchimento).trim()}</p>`;
const palavras = (html) => String(html).replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
const FIXO = palavras(`${ALPHA}${BETA}${GAMMA}`);

/* O rascunho completo que a casca devolve no caminho velho — acima do piso, com
   um id próprio para conferir se o `gravar` mantém o da primeira entrega. */
const draftJson = (enchimento) =>
  JSON.stringify({
    id: "id-da-chamada-inteira",
    title: "Título de fixture",
    dek: "Dek de fixture.",
    content: corpo(enchimento),
    sources: [{ name: "Fixture Daily", url: "https://fixture.example", claim: "pauta original da rodada" }],
    self_check: "ok",
  });

function fx(opts = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, "copia-")) + "/repo";
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  execFileSync("cp", ["-a", `${ROOT}/.`, `${dir}/`], { stdio: "ignore" });
  fs.writeFileSync(
    path.join(dir, "pipeline", "providers.json"),
    JSON.stringify({ provedores: [{ nome: "fixture", tipo: "cli", ativo: true, bin: CASCA, fila: ["Fix"], chamada_max_ms: 30000 }] }, null, 2) + "\n"
  );
  if (opts.mut) {
    const arq = path.join(dir, "tools/write.js");
    const fonte = fs.readFileSync(arq, "utf8");
    const nova = opts.mut(fonte);
    fs.writeFileSync(arq, nova);
    if (nova === fonte) throw new Error("a mutação não encontrou o token em tools/write.js");
  }
  const d = path.join(dir, "pipeline", "drafts", SLUG);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "prompt.md"), "CONTRATO DE FIXTURE: escreva a matéria em JSON puro.\n");
  fs.writeFileSync(path.join(d, "brief.json"), JSON.stringify({ word_count: ALVO, sources: [{ name: "Fixture Daily", url: "https://fixture.example" }] }, null, 2) + "\n");
  if (opts.comFix !== false)
    fs.writeFileSync(path.join(d, "fix.md"), "O editor mecânico reprovou seu draft. Corrija EXATAMENTE estes pontos:\n  ✗ [rhythm] frase com 35 palavras (máximo 30)\nNão mude o que já estava aprovado.\n");
  if (opts.rascunho) {
    fs.writeFileSync(
      path.join(d, "draft.json"),
      JSON.stringify({ id: "fixture-id-antigo", title: "Título de fixture", dek: "Dek.", content: opts.rascunho, sources: [{ name: "Fixture Daily", url: "https://fixture.example", claim: "pauta original da rodada" }], self_check: "ok", image: "images/posts/fixture.jpg", imageAlt: "alt" }, null, 2) + "\n"
    );
  }
  /* As respostas da casca, uma por chamada, com fallback. */
  const rotulo = `res-${verde}-${Math.random().toString(36).slice(2, 7)}`;
  for (const [i, corpoResposta] of (opts.respostas || []).entries()) fs.writeFileSync(path.join(tmp, `${rotulo}-${i + 1}`), corpoResposta);
  fs.writeFileSync(path.join(tmp, `${rotulo}-default`), opts.defaultResposta || draftJson(1128));
  return { dir, drafts: d, rotulo };
}

function roda(c, opts = {}) {
  const cont = path.join(tmp, `cont-${c.rotulo}`);
  const capBase = path.join(tmp, `cap-${c.rotulo}-p`);
  let stderr = "";
  let stdout = "";
  let code = 0;
  try {
    const r = spawnSync(process.execPath, [path.join(c.dir, "tools", "write.js"), SLUG], {
      cwd: c.dir,
      encoding: "utf8",
      timeout: 120000,
      env: { ...process.env, HWP_CONT: cont, HWP_CAP: capBase, HWP_RES: path.join(tmp, c.rotulo), HWP_CASCA_MORRE: String(opts.morre || ""), WRITE_MINUTES: String(opts.minutos || 14) },
    });
    code = r.status ?? -1;
    stdout = String(r.stdout || "");
    stderr = String(r.stderr || "");
  } catch (e) {
    code = e.status ?? -1;
    stderr = String(e.stderr || "");
  }
  const prompts = fs
    .readdirSync(tmp)
    .filter((f) => f.startsWith(`cap-${c.rotulo}-p`))
    .sort((a, b) => Number(a.slice(capBase.length)) - Number(b.slice(capBase.length)))
    .map((f) => fs.readFileSync(path.join(tmp, f), "utf8"));
  const rascunho = fs.existsSync(path.join(c.drafts, "draft.json")) ? JSON.parse(fs.readFileSync(path.join(c.drafts, "draft.json"), "utf8")) : null;
  return { code, stdout, stderr, prompts, rascunho };
}

confere("o piso do fixture é o do word-floor (770 para alvo 1100)", PISO === 770, PISO);
confere("o corpo de fixture tem 18 palavras fixas", FIXO === 18, FIXO);

/* ——— 1. o caso feliz ——— */
console.log("\n1. texto acima do piso + uma frase reprovada: a troca é cirúrgica, e uma chamada só");
{
  const edit = JSON.stringify({ edits: [{ old: "Beta beta beta cauda-única-de-teste", new: "Beta beta beta cauda corrigida de teste" }] });
  const c = fx({ rascunho: corpo(1128), respostas: [edit] });
  const r = roda(c);
  confere("o write.js saiu 0", r.code === 0, `codigo ${r.code} · ${r.stderr.slice(-200)}`);
  confere("uma chamada apenas — o texto inteiro não foi reimpresso", r.prompts.length === 1, `${r.prompts.length} chamadas`);
  confere("o prompt da chamada pede o patch", /REESCRITA CIRÚRGICA/.test(r.prompts[0] || ""), (r.prompts[0] || "").slice(0, 120));
  confere("e mostra o texto atual cru, não o JSON reimpresso", /=== TEXTO ATUAL \(1146 palavras; o piso é 770/.test(r.prompts[0] || ""), (r.prompts[0] || "").match(/=== TEXTO ATUAL[^\n]*/)?.[0] || "cabeçalho ausente");
  confere("nenhuma ordem de reescrever o JSON completo no prompt", !/mesmo comprimento|ACRESCENTE seções|SEU TEXTO ATUAL/.test(r.prompts[0] || ""), "ordem do caminho velho presente");
  confere("a devolutiva do editor está no prompt do patch", /\[rhythm\] frase com 35 palavras/.test(r.prompts[0] || ""));
  confere("o trecho reprovado foi trocado", /cauda corrigida de teste/.test(r.rascunho.content), r.rascunho.content.slice(0, 200));
  confere("o parágrafo que ninguém reprovou está byte a byte igual", r.rascunho.content.includes(ALPHA) && r.rascunho.content.includes(GAMMA), r.rascunho.content);
  confere("o enchimento sobreviveu, e a conta subiu só o da troca", palavras(r.rascunho.content) === 1146 + 3, palavras(r.rascunho.content));
  confere("o id continua o da primeira entrega — o patch não reinventa URL", r.rascunho.id === "fixture-id-antigo", r.rascunho.id);
  confere("a capa do rascunho não se perdeu", r.rascunho.image === "images/posts/fixture.jpg", r.rascunho.image);
  confere("o stdout diz quem escreveu, no formato que o turno lê", /^escrito por fixture\/Fix\/patch: /.test(r.stdout), r.stdout.split("\n")[0]);
  confere("e o stderr conta as trocas", /reescrita cirúrgica: 1 troca\(s\) aplicada\(s\)/.test(r.stderr), r.stderr.slice(-300));
}

/* ——— 2. old ambíguo ——— */
console.log("\n2. two same fragments: nenhuma troca é aplicada às cegas — volta o caminho velho");
{
  const edit = JSON.stringify({ edits: [{ old: "Gamma fragmento repetível", new: "GAMMA Trocado" }] });
  const c = fx({ rascunho: corpo(1128), respostas: [edit, draftJson(1128)] });
  const r = roda(c);
  confere("duas chamadas: o patch errou e o texto inteiro foi pedido", r.prompts.length === 2, `${r.prompts.length} chamadas · ${r.stderr.slice(-160)}`);
  confere("o stderr diz que nenhum old bateu", /nenhum "old" bateu com o texto \(1 tentativa\(s\)\)/.test(r.stderr), r.stderr.slice(-300));
  confere("a segunda chamada é a do contrato velho", /SEU TEXTO ATUAL \(1146 palavras/.test(r.prompts[1] || "") && /mesmo comprimento/.test(r.prompts[1] || ""), (r.prompts[1] || "").slice(-200));
  confere("nenhuma substituição às cegas entrou no rascunho", !/GAMMA Trocado/.test(r.rascunho.content), r.rascunho.content.slice(0, 200));
  confere("a peça saiu do caminho velho, verde", r.code === 0 && palavras(r.rascunho.content) === 1146, `codigo ${r.code}, ${palavras(r.rascunho.content)} palavras`);
}

/* ——— 3. old que não está no texto ——— */
console.log("\n3. o modelo parafraseou o trecho: old inexistente não aplica nada");
{
  const edit = JSON.stringify({ edits: [{ old: "Beta beta beta cauda única de teste (sem hífen)", new: "qualquer coisa" }] });
  const c = fx({ rascunho: corpo(1128), respostas: [edit, draftJson(1128)] });
  const r = roda(c);
  confere("cai no caminho velho com a mesma frase de diagnóstico", /nenhum "old" bateu com o texto/.test(r.stderr) && r.prompts.length === 2, r.stderr.slice(-200));
  confere("e o rascunho não ganha o texto do patch rejeitado", !/qualquer coisa/.test(r.rascunho.content), r.rascunho.content.slice(0, 160));
}

/* ——— 4. o modelo ignora o contrato e devolve a matéria inteira ——— */
console.log("\n4. resposta fora do contrato: não é edits, não é aplicada");
{
  const c = fx({ rascunho: corpo(1128), respostas: [draftJson(1128)] });
  const r = roda(c);
  confere("o stderr chama a resposta pelo nome", /a resposta não é \{"edits":\[…\]\}/.test(r.stderr), r.stderr.slice(-300));
  confere("a matéria completa é aceita logo em seguida, na mesma rodada", r.code === 0 && r.prompts.length === 2, `codigo ${r.code}, ${r.prompts.length} chamadas`);
  confere("e o id do patch não foi gravado pela metade", !/cauda corrigida/.test(r.rascunho.content), r.rascunho.content.slice(0, 160));
}

/* ——— 5. 429 no patch ——— */
console.log("\n5. cota no patch: o erro é do redator, não da peça — o caminho velho ainda entrega");
{
  const c = fx({ rascunho: corpo(1128) });
  const r = roda(c, { morre: 1 });
  confere("o patch reclama do HTTP 429", /reescrita cirúrgica: HTTP 429/.test(r.stderr), r.stderr.slice(-300));
  confere("a rodada não morre ali: o texto inteiro vem na chamada seguinte", r.code === 0 && palavras(r.rascunho.content) === 1146, `codigo ${r.code} · ${r.prompts.length} chamadas`);
}

/* ——— 6. troca que derrubaria o piso ——— */
console.log("\n6. edits que jogariam o texto abaixo do piso não entram");
{
  const edit = JSON.stringify({
    edits: [
      { old: "Gamma fragmento repetível. Gamma fragmento repetível.", new: "Curta." },
      { old: "Beta beta beta cauda-única-de-teste", new: "Brevíssima." },
    ],
  });
  const c = fx({ rascunho: corpo(758), respostas: [edit, draftJson(1128)] });
  /* 18 + 758 = 776 palavras: acima do piso por 6. As duas trocas tiram 8 → 768. */
  confere("o fixture está mesmo a um fio do piso", palavras(corpo(758)) === PISO + 6, palavras(corpo(758)));
  const r = roda(c);
  confere("o stderr diz que as trocas derrubariam o texto", /derrubariam o texto para 768 palavras, sob o piso 770/.test(r.stderr), r.stderr.slice(-300));
  confere("nada das trocas curtas ficou no disco", !/Curta\.|Brevíssima/.test(r.rascunho.content), r.rascunho.content.slice(0, 200));
  confere("e a peça chega pelo caminho velho", r.code === 0 && palavras(r.rascunho.content) === 1146, `${palavras(r.rascunho.content)} palavras`);
}

/* ——— 7. abaixo do piso: lá a ordem é ACRESCENTE, e o texto tem de ser inteiro ——— */
console.log("\n7. texto abaixo do piso: o patch não entra — expandir é reescrever");
{
  const c = fx({ rascunho: corpo(582), respostas: [JSON.stringify({ edits: [{ old: "Beta beta beta cauda-única-de-teste", new: "Beta corrigido" }] })] });
  const r = roda(c);
  confere("uma chamada só, e ela é a de expansão", r.prompts.length === 1 && /ACRESCENTE seções até passar de 770/.test(r.prompts[0] || ""), `${r.prompts.length} chamadas`);
  confere("nenhum pedido de edits no prompt", !/REESCRITA CIRÚRGICA/.test(r.prompts[0] || ""));
  confere("o stderr não fala de cirurgia", !/cirúrgica/.test(r.stderr), r.stderr.slice(-200));
}

/* ——— 8. parede curta ——— */
console.log("\n8. sem folga de parede: o patch fica de fora para não comer a única tentativa");
{
  const c = fx({ rascunho: corpo(1128), respostas: [draftJson(1128), JSON.stringify({ edits: [{ old: "Beta beta beta cauda-única-de-teste", new: "Beta corrigido" }] })] });
  const r = roda(c, { minutos: 6 });
  confere("com 6 min de parede o patch não é chamado", !/REESCRITA CIRÚRGICA/.test(r.prompts[0] || "") && /mesmo comprimento/.test(r.prompts[0] || ""), r.prompts[0]?.slice(-160));
  confere("e o tempo todo foi para o texto inteiro", r.prompts.length === 1 && r.code === 0, `${r.prompts.length} chamadas, codigo ${r.code}`);
}

/* ——— 9. sem fix.md (primeira escrita) ——— */
console.log("\n9. primeira entrega, sem devolutiva: nada de patch");
{
  const c = fx({ rascunho: corpo(1128), comFix: false });
  const r = roda(c);
  confere("nenhum bloco cirúrgico no prompt", !/REESCRITA CIRÚRGICA/.test(r.prompts[0] || ""), r.prompts[0]?.slice(-160));
  confere("uma chamada, o contrato de sempre", r.prompts.length === 1 && r.code === 0);
}

/* ——— 10/11. mutações: cada boca compra um comportamento ——— */
console.log("\n10. falsificação: afrouxar a unicidade do old aplica a troca às cegas");
{
  const edit = JSON.stringify({ edits: [{ old: "Gamma fragmento repetível", new: "GAMMA Trocado" }] });
  const c = fx({
    rascunho: corpo(1128),
    respostas: [edit],
    mut: (fonte) => fonte.replace("if (vezes !== 1 || !novo) {", "if (vezes < 1 || !novo) {"),
  });
  confere("a mutação encontrou o guard de unicidade", fs.readFileSync(path.join(c.dir, "tools/write.js"), "utf8").includes("if (vezes < 1 || !novo) {"));
  const r = roda(c);
  confere("com o guard arrancado a primeira ocorrência é trocada e a segunda não", /GAMMA Trocado.*Gamma fragmento repetível/s.test(r.rascunho.content), r.rascunho.content.slice(0, 260));
  confere("e a rodada não pede o texto inteiro: saiu na hora", r.prompts.length === 1 && r.code === 0, `${r.prompts.length} chamadas, codigo ${r.code}`);
}

console.log("\n11. falsificação: arrancar a folga de parede põe o patch dentro da última tentativa");
{
  const edit = JSON.stringify({ edits: [{ old: "Beta beta beta cauda-única-de-teste", new: "Beta corrigido" }] });
  const c = fx({
    rascunho: corpo(1128),
    respostas: [edit],
    mut: (fonte) => fonte.replace("fim - Date.now() > 420000", "fim - Date.now() > 0"),
  });
  confere("a mutação encontrou a folga", fs.readFileSync(path.join(c.dir, "tools/write.js"), "utf8").includes("fim - Date.now() > 0"));
  const r = roda(c, { minutos: 6 });
  confere("com a folga arrancada o patch entra com 6 min de parede", /REESCRITA CIRÚRGICA/.test(r.prompts[0] || ""), r.prompts[0]?.slice(-160));
  confere("e come a fatia que seria do texto inteiro", r.prompts.length === 1, `${r.prompts.length} chamadas`);
}

/* ——— invariante ——— */
/* ——— 12. lote a meio: um `old` exato e um ambíguo NÃO é reescrita concluída ——— */
console.log("\n12. lote misto: o `old` que não bate devolve o texto inteiro, não um rascunho a meio");
{
  const misto = JSON.stringify({
    edits: [
      { old: "Beta beta beta cauda-única-de-teste", new: "Beta beta beta cauda corrigida de teste" },
      { old: "Gamma fragmento repetível", new: "GAMMA agora único" },
    ],
  });
  const c = fx({ rascunho: corpo(1128), respostas: [misto] });
  const r = roda(c);
  confere("o patch foi tentado primeiro", /REESCRITA CIRÚRGICA/.test(r.prompts[0] || ""), (r.prompts[0] || "").slice(0, 120));
  confere("e o diário conta o lote a meio, não uma troca aceita", /1 de 2 "old" sem correspondência exata/.test(r.stderr), r.stderr.slice(-300));
  confere("a segunda chamada é o texto inteiro (o fallback não custa a peça)", r.prompts.length === 2 && /mesmo comprimento|SEU TEXTO ATUAL|ACRESCENTE/.test(r.prompts[1] || ""), `${r.prompts.length} chamada(s)`);
  confere("a rodada sai 0 pela boca velha", r.code === 0, `codigo ${r.code}`);
  confere("nenhum fragmento do lote parcial ficou no disco", !/cauda corrigida de teste/.test(r.rascunho.content), r.rascunho.content.slice(0, 220));
  confere("e o corpo no disco é o da chamada inteira, não o da troca a meio", r.rascunho.content === corpo(1128), String(r.rascunho.content).slice(0, 220));

  /* Mutação: arrancar o portão do lote devolve o defeito — o ponto que o júri
     reprovou continua de pé, com exit 0 e uma chamada gasta. */
  const c2 = fx({ rascunho: corpo(1128), respostas: [misto], mut: (f) => f.replace('else if (dudas) caiFora(', 'else if (false) caiFora(') });
  const r2 = roda(c2);
  confere("com o portão arrancado o lote parcial passa por reescrita", r2.prompts.length === 1 && r2.code === 0, `${r2.prompts.length} chamada(s), codigo ${r2.code}`);
  confere("a troca boa entra, a reprovada fica", /cauda corrigida de teste/.test(r2.rascunho.content) && /Gamma fragmento repetível\. Gamma fragmento repetível\./.test(r2.rascunho.content), r2.rascunho.content.slice(0, 220));
}

/* ——— 13. `new` igual a `old`: nada mudou, e o ponto reprovado continua de pé ——— */
console.log("\n13. no-op: o modelo devolve a mesma frase e isso não é conserto");
{
  const noOp = JSON.stringify({ edits: [{ old: "Beta beta beta cauda-única-de-teste", new: "Beta beta beta cauda-única-de-teste" }] });
  const c = fx({ rascunho: corpo(1128), respostas: [noOp] });
  const r = roda(c);
  confere("o diário diz que nenhuma palavra mudou", /new` igual a `old/.test(r.stderr), r.stderr.slice(-300));
  confere("e a chamada inteira vem em seguida", r.prompts.length === 2 && /REESCRITA CIRÚRGICA/.test(r.prompts[0] || ""), `${r.prompts.length} chamada(s)`);
  confere("a peça sai pela boca velha", r.code === 0 && r.rascunho.content === corpo(1128), `codigo ${r.code}`);

  const c2 = fx({ rascunho: corpo(1128), respostas: [noOp], mut: (f) => f.replace('else if (corpo === anterior.content) caiFora(', 'else if (false) caiFora(') });
  const r2 = roda(c2);
  confere("sem o guard o no-op sai verde com o texto idêntico", r2.code === 0 && r2.prompts.length === 1 && r2.rascunho.content === corpo(1128), `${r2.prompts.length} chamada(s), codigo ${r2.code}`);
}

console.log("\n14. invariante: a máquina do dono não foi tocada");
{
  const gitDepois = execFileSync("git", ["-C", ROOT, "status", "--porcelain", "-uno"], { encoding: "utf8" });
  confere("o repo real está como estava", gitDepois === gitAntes, gitDepois.split("\n").join(" ⏎ "));
  confere("a memória real continua byte a byte a mesma", fs.readFileSync(path.join(ROOT, "pipeline/memory.json"), "utf8") === memRealAntes);
  confere("nenhum rascunho de fixture entrou no pipeline/drafts real", !fs.existsSync(path.join(ROOT, "pipeline/drafts", SLUG)), "apareceu no repo");
  for (const sobra of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, sobra), { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  confere("nenhuma cópia desta prova ficou no /tmp", !fs.existsSync(tmp), `${path.basename(tmp)} continuou no disco`);
}

console.log(`\n${verde} conferências verdes, ${falhas.length} vermelhas${falhas.length ? ": " + falhas.join(" | ") : ""}.`);
process.exit(falhas.length ? 1 : 0);
