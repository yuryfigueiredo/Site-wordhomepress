/* teste-trava-rascunho.js — a trava do diretório de rascunho vale enquanto a
   tentativa vale, e não para sempre.

   O defeito, medido nos dados reais em 15/11: `pipeline/drafts/` é gitignored e
   sobrevive ao `git clean -fdq` (sem `-x`) do runner, então um diretório criado
   por uma rodada morta prendia a pauta em `rascunho_ou_id` em toda rodada
   seguinte, para sempre. A tabela `lead_retry_hours` — que é a régua declarada
   de "quando esta pauta pode voltar", e que acabou de ganhar `falha_texto` 24h
   justamente para a morte do redator não enterrar a matéria por 72h — não
   chegava a valer: o diretório mandava mais que ela. 3 de 3 `falha_texto` e 2
   de 4 `reprovada` tinham diretório no disco; 11 trava(s) vencidas estavam
   abertas agora. Cada redator que morria reduzia o suprimento do dia em uma, e
   suprimento é o teto: 5 publicações não saem de uma fila que encolhe.

   A correção não afrouxa trava nenhuma: sem registro na memória (pode ser
   rascunho do dono, ou trabalho de uma rodada em curso que ainda não registrou)
   o diretório continua prendendo, e enquanto `mem.bloqueada()` disser que a
   tentativa está aberta ele prende também.

   Tudo roda numa CÓPIA do repo em /tmp. O pick-leda real faz a sondagem de
   rede das candidatas, e aqui as URLs são de fixture: a sondagem falha rápido,
   nenhuma chave é gasta, e o que se confere é a classificação que ele imprime
   no stderr antes de morrer — `rascunho_ou_id` e a linha de liberação.        */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawn, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const REPO_REAL = ROOT;
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

const gitAntes = execFileSync("git", ["-C", REPO_REAL, "status", "--porcelain", "-uno"], { encoding: "utf8" });
const memRealAntes = fs.readFileSync(path.join(REPO_REAL, "pipeline/memory.json"), "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hwp-trava-"));
const horasAtras = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

/* Uma fila com três candidatas distintas e três diretórios de rascunho
   correspondentes. O que muda de caso para caso é só a memória. */
const PISTAS = [
  { title: "Pauta de fixture um sobre roteadores de quintal", url: "https://fixture.example/um", slug: "pauta-de-fixture-um-sobre-roteadores-de-quintal" },
  { title: "Pauta de fixture dois sobre memoria de agua", url: "https://fixture.example/doi", slug: "pauta-de-fixture-dois-sobre-memoria-de-agua" },
  { title: "Pauta de fixture tres sobre telescopios velhos", url: "https://fixture.example/tres", slug: "pauta-de-fixture-tres-sobre-telescopios-velhos" },
];

function copia(memLeads, dirs, mut, fila) {
  const dir = path.join(tmp, `copia-${mut ? "mut" : "ok"}-${verde}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  execFileSync("cp", ["-a", `${ROOT}/.`, `${dir}/`], { stdio: "ignore" });
  const leads = path.join(dir, "pipeline", "leads");
  const drafts = path.join(dir, "pipeline", "drafts");
  /* A cópia traz as filas e os rascunhos reais da máquina (cp -a), e as três
     filas mais recentes reais têm 200+ candidaturas presas por 27 diretórios
     reais — a contagem de `rascunho_ou_id` viria do repo do dono, não do
     fixture. Aqui a mesa é fechada: só o que esta prova planta existe.       */
  fs.rmSync(leads, { recursive: true, force: true });
  fs.rmSync(drafts, { recursive: true, force: true });
  fs.mkdirSync(leads, { recursive: true });
  const PISTA = (p, i) => ({ title: p.title, url: p.url, pillar: "science", source: "Fixture Daily", score: 9 - i, published: horasAtras(3) });
  fs.writeFileSync(
    path.join(leads, "2026-11-15.json"),
    JSON.stringify({ dia: "2026-11-15", leads: (fila || PISTAS).map(PISTA) }, null, 2) + "\n"
  );
  for (const d of dirs) {
    fs.mkdirSync(path.join(drafts, d), { recursive: true });
    fs.writeFileSync(path.join(drafts, d, "brief.json"), JSON.stringify({ word_count: 1100, sources: [{ name: "Fixture Daily", url: `https://fixture.example/${d}` }] }, null, 2) + "\n");
  }
  fs.writeFileSync(path.join(dir, "pipeline", "memory.json"), JSON.stringify({ leads: memLeads, fontes: {} }, null, 2) + "\n");
  if (mut) {
    const arq = path.join(dir, "tools", "pick-lead.js");
    const fonte = fs.readFileSync(arq, "utf8");
    fs.writeFileSync(arq, mut(fonte));
  }
  return dir;
}

function seco(dir) {
  const r = spawnSync(process.execPath, [path.join(dir, "tools", "pick-lead.js"), "--dry"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 240000,
  });
  const err = String(r.stderr || "");
  return {
    stdout: String(r.stdout || ""),
    codigo: r.status ?? -1,
    err,
    rascunho: Number((err.match(/(\d+) com rascunho\/id no ar/) || [])[1] ?? -1),
    liberados: Number((err.match(/(\d+) rascunho\(s\) de tentativa já vencida/) || [])[1] ?? 0),
  };
}

console.log("1. as três travas estão abertas: tentativa ainda na janela");
{
  const dir = copia(
    {
      "https://fixture.example/um": { outcome: "em_andamento", at: horasAtras(1), slug: PISTAS[0].slug, topic: PISTAS[0].title },
      "https://fixture.example/doi": { outcome: "falha_texto", at: horasAtras(6), slug: PISTAS[1].slug, topic: PISTAS[1].title },
      "https://fixture.example/tres": { outcome: "reprovada", at: horasAtras(30), slug: PISTAS[2].slug, topic: PISTAS[2].title },
    },
    [PISTAS[0].slug, PISTAS[1].slug, PISTAS[2].slug]
  );
  const r = seco(dir);
  confere("nenhuma das três é liberada", r.liberados === 0, r.err.split("\n").filter((l) => /liberado/.test(l)).join(" ⏎ "));
  confere("as três continuam contadas como rascunho/id", r.rascunho === 3, `veio ${r.rascunho}`);
}

console.log("\n2. a janela do falha_texto venceu (25h contra 24h): a pauta volta");
{
  const dir = copia(
    {
      "https://fixture.example/um": { outcome: "em_andamento", at: horasAtras(1), slug: PISTAS[0].slug, topic: PISTAS[0].title },
      "https://fixture.example/doi": { outcome: "falha_texto", at: horasAtras(25), slug: PISTAS[1].slug, topic: PISTAS[1].title },
      "https://fixture.example/tres": { outcome: "reprovada", at: horasAtras(30), slug: PISTAS[2].slug, topic: PISTAS[2].title },
    },
    [PISTAS[0].slug, PISTAS[1].slug, PISTAS[2].slug]
  );
  const r = seco(dir);
  confere("a trava vencida é liberada", r.liberados === 1, `veio ${r.liberados} · ${r.err.split("\n").filter((l) => /liberado/.test(l)).join(" ⏎ ")}`);
  confere("e sai da conta de rascunho/id (3 → 2)", r.rascunho === 2, `veio ${r.rascunho}`);
  confere("o diretório do rascunho continua no disco, intacto", fs.existsSync(path.join(dir, "pipeline/drafts", PISTAS[1].slug, "brief.json")), "foi apagado");
}

console.log("\n2b. a janela da reprovada é outra (72h), e é ela que manda: 73h solta, 30h prende");
{
  const base = { "https://fixture.example/um": { outcome: "em_andamento", at: horasAtras(1), slug: PISTAS[0].slug, topic: PISTAS[0].title } };
  const comTrava = copia({ ...base, "https://fixture.example/tres": { outcome: "reprovada", at: horasAtras(30), slug: PISTAS[2].slug, topic: PISTAS[2].title } }, [PISTAS[2].slug]);
  const r1 = seco(comTrava);
  confere("reprovada há 30h continua presa (a janela declarada é 72h)", r1.liberados === 0 && r1.rascunho === 1, `liberados=${r1.liberados} rascunho=${r1.rascunho}`);
  const semTrava = copia({ ...base, "https://fixture.example/tres": { outcome: "reprovada", at: horasAtras(73), slug: PISTAS[2].slug, topic: PISTAS[2].title } }, [PISTAS[2].slug]);
  const r2 = seco(semTrava);
  confere("vencidas as 72h a mesma pauta volta, sem apagar o rascunho", r2.liberados === 1 && r2.rascunho === 0, `liberados=${r2.liberados} rascunho=${r2.rascunho}`);
  confere("e o cadence.json é o que manda, não um número no código", JSON.parse(fs.readFileSync(path.join(REPO_REAL, "pipeline/cadence.json"), "utf8")).lead_retry_hours.reprovada === 72);
}

console.log("\n3. rascunho sem registro na memória não é liberado: pode ser trabalho do dono");
{
  const dir = copia({ "https://fixture.example/um": { outcome: "em_andamento", at: horasAtras(1), slug: PISTAS[0].slug, topic: PISTAS[0].title } }, [PISTAS[1].slug]);
  const r = seco(dir);
  confere("sem registro, a trava vale", r.liberados === 0 && r.rascunho === 1, `liberados=${r.liberados} rascunho=${r.rascunho}`);
}

console.log("\n4. registro sem slug (formato antigo) não solta a trava por acidente");
{
  const dir = copia({ "https://fixture.example/doi": { outcome: "falha_texto", at: horasAtras(100) } }, [PISTAS[1].slug]);
  const r = seco(dir);
  confere("sem slug no registro não há como saber de quem é o diretório — prende", r.liberados === 0 && r.rascunho === 1, `liberados=${r.liberados} rascunho=${r.rascunho}`);
}

console.log("\n5. falsificação: arrancar a liberação devolve a trava perpétua");
{
  const dir = copia(
    {
      "https://fixture.example/um": { outcome: "em_andamento", at: horasAtras(1), slug: PISTAS[0].slug, topic: PISTAS[0].title },
      "https://fixture.example/doi": { outcome: "falha_texto", at: horasAtras(25), slug: PISTAS[1].slug, topic: PISTAS[1].title },
    },
    [PISTAS[0].slug, PISTAS[1].slug],
    (fonte) => fonte.replace("if (tentadasComSlug.has(d) && !tentandoAinda.has(d)) {", "if (false) {")
  );
  const r = seco(dir);
  confere("a mutação encontrou o guard", fs.readFileSync(path.join(dir, "tools", "pick-lead.js"), "utf8").includes("if (false) {"), "token não achado");
  confere("com o guard arrancado a pauta de 25h volta a prender", r.liberados === 0 && r.rascunho === 2, `liberados=${r.liberados} rascunho=${r.rascunho}`);
}

console.log("\n6. falsificação ao contrário: liberar tudo quebra a trava de tentativa viva");
{
  const dir = copia(
    { "https://fixture.example/um": { outcome: "em_andamento", at: horasAtras(1), slug: PISTAS[0].slug, topic: PISTAS[0].title } },
    [PISTAS[0].slug],
    (fonte) => fonte.replace("if (tentadasComSlug.has(d) && !tentandoAinda.has(d)) {", "if (tentadasComSlug.has(d)) {")
  );
  const r = seco(dir);
  confere("liberar sem olhar a janela solta uma pauta que a rodada está escrevendo", r.liberados === 1 && r.rascunho === 0, `liberados=${r.liberados} rascunho=${r.rascunho}`);
}

console.log("\n6b. sem rede NÃO é pauta morta: a varredura inteira falha, nada é marcado e o pick-lead sai 2");
{
  /* O caso é real e medido: com o link caído toda sonda morre em falha de
     transporte, e a versão antiga enterrava a fila inteira por 12h por
     `fonte_inalcancavel` — R3 contou duas pautas boas marcadas em um segundo,
     sem uma resposta HTTP sequer. O proxy apontado para uma porta fechada é a
     mesma máquina sem rede, reproduzível e sem esperar o Wi-Fi cair. */
  const SEM_REDE = { ...process.env, NODE_USE_ENV_PROXY: "1", HTTPS_PROXY: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9" };
  const varre = (dir) => {
    const r = spawnSync(process.execPath, [path.join(dir, "tools", "pick-lead.js")], { cwd: dir, encoding: "utf8", timeout: 240000, env: SEM_REDE });
    const mem = JSON.parse(fs.readFileSync(path.join(dir, "pipeline", "memory.json"), "utf8"));
    return {
      codigo: r.status ?? -1,
      marcadas: Object.values(mem.leads || {}).filter((l) => l && l.outcome === "fonte_inalcancavel").length,
    };
  };
  const travaViva = { "https://fixture.example/um": { outcome: "em_andamento", at: horasAtras(1), slug: PISTAS[0].slug, topic: PISTAS[0].title } };
  const dir = copia(travaViva, [PISTAS[0].slug]);
  const r = varre(dir);
  confere("o portão devolve 2, não 1 — a rodada distingue link caído de fila vazia", r.codigo === 2, `codigo=${r.codigo}`);
  confere("nenhuma pauta saiu da fila por causa do link", r.marcadas === 0, `${r.marcadas} marcações de 12h`);
  /* Duas mutações, uma por boca: o código de saída e a marcação. Trocar só o
     portão do fim mostra que exit 2 é consequência dele; trocar só a
     classificação mostra que o que salva a fila é distinguir o sintoma. */
  const semPortao = copia(travaViva, [PISTAS[0].slug], (fonte) => fonte.replace("if (!naoAbre && (semRede || empacou)) {", "if (false) {"));
  confere("a mutação encontrou o portão de saída", !fs.readFileSync(path.join(semPortao, "tools/pick-lead.js"), "utf8").includes("if (!naoAbre && (semRede || empacou)) {"), "token não achado");
  const p = varre(semPortao);
  confere("arrancado o portão a mesma varredura diz 1 — a rodada trataria link caído como fila vazia", p.codigo === 1 && p.marcadas === 0, `codigo=${p.codigo}, marcou ${p.marcadas}`);
  const semClasse = copia(travaViva, [PISTAS[0].slug], (fonte) =>
    fonte.replace('/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|UND_ERR_CONNECT|getaddrinfo/i.test(sinal) ? "sem-rede" : "nao-abre"', '"nao-abre"')
  );
  confere("a mutação encontrou a classificação", !fs.readFileSync(path.join(semClasse, "tools/pick-lead.js"), "utf8").includes('"sem-rede" : "nao-abre"'), "o replace não alcançou a sonda");
  const m = varre(semClasse);
  confere("com a classificação antiga as duas pautas vivas saem da fila por 12h", m.marcadas === 2 && m.codigo === 1, `marcou ${m.marcadas}, codigo ${m.codigo}`);
}

console.log("\n6c. fonte que aceita a conexão e cala é fato do transporte: nada marcado, exit 2, e a 404 do lado continua pagando");
{
  /* O caso não é o Wi-Fi caído do 6b: aqui o pacote sai, o SYN/ACK vem, e a
     fonte nunca responde. Medido em servidor que aceita e cala, sondado com o
     mesmo `AbortSignal.timeout(10000)` do pick-lead, a exceção chega como
     `TimeoutError` com `code` 23 (NÚMERO, não string) e mensagem "The
     operation was aborted due to timeout" — nenhum token do regex antigo casa,
     então o veredito era `nao-abre` e a pauta saía por 12h. Na máquina real
     duas candidatas boas foram gravadas `fonte_inalcancavel` com 10,007 s de
     diferença entre si (a digital do AbortSignal) e a varredura devolveu 1,
     não 2: fila enterrada e rodada verde sem peça.
     O servidor nasce num filho e o pai espera o arquivo `pronto` com um laço
     de `sh`, porque `spawnSync` do pick-lead bloqueia o event loop e um
     `listen(0)` não teria como publicar a porta sem ele rodar. */
  const PRONTO = path.join(tmp, "servidores-pronto");
  const filho = spawn(
    process.execPath,
    [
      "-e",
      `const net=require("net"),fs=require("fs");
       const morto=net.createServer((s)=>s.end("HTTP/1.1 404 Not Found\\r\\ncontent-length: 0\\r\\n\\r\\n"));
       const buraco=net.createServer(()=>{});
       let n=0;
       const avisa=()=>{ if(n<2)return; fs.writeFileSync(${JSON.stringify(PRONTO)}, "PRONTO "+buraco.address().port+" "+morto.address().port); };
       buraco.listen(0,"127.0.0.1",()=>{n++;avisa();});
       morto.listen(0,"127.0.0.1",()=>{n++;avisa();});
       setTimeout(()=>process.exit(0),420000);`,
    ],
    { detached: true, stdio: "ignore" }
  );
  filho.unref();
  const espera = spawnSync("sh", ["-c", `for i in $(seq 200); do [ -s ${PRONTO} ] && exit 0; sleep 0.1; done; exit 1`], { encoding: "utf8" });
  const [portaBuraco, portaMorta] = (espera.status === 0 ? fs.readFileSync(PRONTO, "utf8") : "").split(/\s+/).slice(1).map(Number);
  confere("os dois servidores de fixture estão de pé", !!portaBuraco && !!portaMorta, `espera.status=${espera.status}`);

  const P = (i, url) => ({ title: `Pauta de fixture ${i} sobre antenas de quintal numero ${i}`, url });
  const FILA_BURACO = [P(1, `http://127.0.0.1:${portaBuraco}/a`), P(2, `http://127.0.0.1:${portaBuraco}/b`), P(3, `http://127.0.0.1:${portaBuraco}/c`)];
  const FILA_MISTURA = [P(4, `http://127.0.0.1:${portaMorta}/d`), P(5, `http://127.0.0.1:${portaBuraco}/e`), P(6, `http://127.0.0.1:${portaBuraco}/f`)];

  const varre = (dir) => {
    const r = spawnSync(process.execPath, [path.join(dir, "tools", "pick-lead.js")], { cwd: dir, encoding: "utf8", timeout: 300000 });
    const mem = JSON.parse(fs.readFileSync(path.join(dir, "pipeline", "memory.json"), "utf8"));
    return {
      codigo: r.status ?? -1,
      err: String(r.stderr || ""),
      marcadas: Object.values(mem.leads || {}).filter((l) => l && l.outcome === "fonte_inalcancavel").length,
    };
  };

  const r = varre(copia({}, [], null, FILA_BURACO));
  confere("três fontes que aceitam e calam devolvem 2, não 1", r.codigo === 2, `codigo=${r.codigo}`);
  confere("nenhuma das três saiu da fila por 12h", r.marcadas === 0, `${r.marcadas} marcações`);
  confere("a causa dita timeout, não 'sem rede nesta máquina'", /nenhuma resposta em 10s/.test(r.err) && !/sem rede nesta máquina/.test(r.err), r.err.split("\n").filter((l) => /não sondada|nenhuma sonda/.test(l)).join(" ⏎ "));

  const m = varre(copia({}, [], null, FILA_MISTURA));
  confere("uma resposta HTTP na varredura prova que o link existe: sai 1", m.codigo === 1, `codigo=${m.codigo}`);
  confere("e só a fonte que devolveu 404 paga as 12h", m.marcadas === 1, `marcou ${m.marcadas} de 3`);

  const LINHA_TIMEOUT = 'if (/TimeoutError|due to timeout|ETIMEDOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT/i.test(sinal)) return "empacou";';
  const semClasseTimeout = copia({}, [], (fonte) => fonte.replace(LINHA_TIMEOUT, ""), FILA_BURACO);
  confere("a mutação arrancou mesmo o classificador de timeout", !fs.readFileSync(path.join(semClasseTimeout, "tools/pick-lead.js"), "utf8").includes('return "empacou"'), "o replace não alcançou a linha");
  const g = varre(semClasseTimeout);
  confere("com o classificador arrancado as três voltam a ser enterradas por 12h", g.marcadas === 3 && g.codigo === 1, `marcou ${g.marcadas}, codigo ${g.codigo}`);

  spawnSync("kill", [String(filho.pid)]);
  fs.rmSync(PRONTO, { force: true });
}

console.log("\n7. invariante: a máquina do dono não foi tocada");
{
  const gitDepois = execFileSync("git", ["-C", REPO_REAL, "status", "--porcelain", "-uno"], { encoding: "utf8" });
  confere("o repo real está como estava", gitDepois === gitAntes, gitDepois.split("\n").join(" ⏎ "));
  const memRealAgora = fs.readFileSync(path.join(REPO_REAL, "pipeline/memory.json"), "utf8");
  confere("a memória real continua byte a byte a mesma", memRealAgora === memRealAntes, `${memRealAntes.length} → ${memRealAgora.length} bytes`);
  confere("nenhum diretório de fixture entrou no pipeline/drafts real", !fs.existsSync(path.join(REPO_REAL, "pipeline/drafts", PISTAS[0].slug)), "apareceu no repo");
  for (const sobra of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, sobra), { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  confere("nenhuma cópia desta prova ficou no /tmp", !fs.existsSync(tmp), `${path.basename(tmp)} continuou no disco`);
}

console.log(`\n${verde} conferências verdes, ${falhas.length} vermelhas${falhas.length ? ": " + falhas.join(" | ") : ""}.`);
process.exit(falhas.length ? 1 : 0);
