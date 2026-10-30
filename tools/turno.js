/* turno.js — uma rodada completa do robô, idêntica no seu PC e no GitHub Actions.
   Coleta → manutenção → teto diário → pauta → brief → texto (Gemini) → editor
   mecânico (até 3 tentativas) → nota → publicação. Nunca faz push e nunca faz
   deploy: quem commita/envia é o workflow. Escreve TURNO.md, o relatório que
   substitui o painel quando o seu PC está desligado.

   Uso: node tools/turno.js          (exit 0 mesmo quando a rodada para cedo)  */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const log = [];
const say = (stage, msg) => { log.push(`- **${stage}** — ${msg}`); console.log(`[${stage}] ${msg}`); };

function run(script, args = []) {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, "tools", script), ...args], { cwd: ROOT, stdio: "pipe", timeout: 900000 }).toString();
    return { code: 0, out };
  } catch (err) {
    return { code: err.status || 1, out: String(err.stdout || "") + String(err.stderr || "") };
  }
}
const finish = (why) => {
  if (why) say("fim", why);
  const head = `# Turno — ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC\n\n`;
  fs.writeFileSync(path.join(ROOT, "TURNO.md"), head + log.join("\n") + "\n");
  process.exit(0);
};

/* 1. coleta */
const ing = run("ingest.js");
say("coleta", ing.code === 0 ? (ing.out.trim().split("\n").pop() || "ok") : `falhou: ${ing.out.slice(-200)}`);

/* 2. manutenção: com erro aberto não se publica nada */
const doc = run("doctor.js", ["--offline"]);
const docLine = (doc.out.match(/errors \d+ \| .*warnings \d+/) || ["sem resumo"])[0];
say("manutenção", docLine);
if (doc.code !== 0) finish("doctor terminou com erros — a rodada para aqui por segurança.");

/* 3. teto diário */
const cad = JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "cadence.json"), "utf8"));
let done = 0;
try { done = (JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "state", "publish-log.json"), "utf8")).days || {})[new Date().toISOString().slice(0, 10)] || 0; } catch {}
say("cadência", `${done}/${cad.max_publishes_per_day} publicação(ões) hoje`);
if (done >= cad.max_publishes_per_day) finish("teto diário atingido — as próximas rodadas só coletam e checam.");

/* 4. pauta */
const pick = run("pick-lead.js");
if (pick.code !== 0) finish(pick.out.trim() || "sem pauta nova.");
const lead = JSON.parse(pick.out.trim().split("\n").pop());
say("pauta", `${lead.topic} (${lead.source}, score ${lead.score})`);

/* 5. brief */
const brief = run("new-post.js", ["--url", lead.url, "--pillar", lead.pillar, "--topic", lead.topic, "--slug", lead.slug]);
if (brief.code !== 0) finish(`brief falhou: ${brief.out.slice(-300)}`);
say("brief", `pipeline/drafts/${lead.slug}/ criado`);

/* 6. texto */
const prov = require("./lib/providers");
if (!prov.armados().length) finish(`nenhum provedor de texto armado — sem chave no ambiente, o redator não roda. As chaves que valem são as de pipeline/providers.json: ${prov.configurados().map((p) => p.chave_env).join(", ")}.`);
const wrote = run("write.js", [lead.slug]);
if (wrote.code !== 0) finish(`o redator não entregou texto: ${wrote.out.trim().split("\n").slice(-8).join(" · ").slice(0, 900)}`);
say("texto", wrote.out.trim().split("\n")[0]);
const capa = run("make-cover.js", [lead.slug]);
say("capa", capa.code === 0 ? capa.out.trim().split("\n")[0] : `falhou: ${capa.out.trim().slice(-200)}`);

/* 7. editor mecânico, até 3 tentativas com devolutiva */
let check = { code: 1, out: "" };
for (let t = 1; t <= 3; t++) {
  check = run("check-post.js", [lead.slug]);
  if (check.code === 0) { say("edição", `aprovado na tentativa ${t}`); break; }
  const rejs = check.out.split("\n").filter((l) => l.includes("✗")).slice(0, 6).join("\n");
  say("edição", `tentativa ${t} reprovada: ${rejs.replace(/\n/g, " · ").slice(0, 220)}`);
  if (t === 3) break;
  fs.writeFileSync(path.join(ROOT, "pipeline", "drafts", lead.slug, "fix.md"),
    `O editor mecânico reprovou seu draft. Corrija EXATAMENTE estes pontos e devolva o JSON completo de novo:\n${rejs}\nNão mude o que já estava aprovado.`);
  const fix = run("write.js", [lead.slug]);
  if (fix.code !== 0) { say("edição", "reescreva falhou: " + fix.out.trim().split("\n").slice(-1)[0]); break; }
  run("make-cover.js", [lead.slug]);
}
if (check.code !== 0) finish("rascunho ficou reprovado depois de 3 tentativas — guardado para revisão humana, nada publicado.");

/* 8. nota */
const sc = run("score.js", ["--draft", lead.slug]);
const nota = (sc.out.match(/nota ([\d.]+)\/10/) || [])[1];
say("nota", nota ? `${nota}/10 · ${(sc.out.split("\n")[1] || "").slice(0, 160)}` : sc.out.trim().split("\n")[0]);
if (/DUPLICATA/.test(sc.out)) finish("nota calculada aponta quase-duplicata — nada publicado.");

/* 9. publicação */
const pub = run("publish.js", [lead.slug]);
if (pub.code !== 0) finish(`publicação abortada pelo próprio publish.js: ${pub.out.trim().split("\n").slice(-2).join(" ")}`);
say("publicação", pub.out.trim().split("\n").slice(0, 2).join(" · "));
finish("rodada completa. O commit e o push são do workflow; o deploy é do Pages.");
