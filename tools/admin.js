/* admin.js — painel local de supervisão. Não é um CMS: o robô publica sozinho.
   Serve para você ver o que entrou, o que foi reprovado e por quê, e para
   intervir quando quiser (publicar na hora, dar nota manual, travar o dia).

   Sobe só em 127.0.0.1 — nada aqui é exposto para a internet.
   Uso: node tools/admin.js [porta]     padrão 8099
   Depois: http://127.0.0.1:8099                                     */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2] || 8099);
const HOST = "127.0.0.1";

const read = (p, fb = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fb; } };
const readText = (p, fb = "") => { try { return fs.readFileSync(p, "utf8"); } catch { return fb; } };
const today = () => new Date().toISOString().slice(0, 10);
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const DB_FILE = path.join(ROOT, "js", "articles-db.js");
function DB() {
  /* Recarrega a cada chamada: o catálogo muda quando o robô publica. */
  delete require.cache[require.resolve(DB_FILE)];
  global.window = {};
  require(DB_FILE);
  return global.window.HWP_DATABASE;
}

const SLUG_OK = (s) => /^[a-z0-9_-]+$/.test(String(s || ""));
const URL_OK = (s) => /^https?:\/\/[^\s"'<>]+$/.test(String(s || ""));

function run(script, args, cb) {
  execFile(process.execPath, [path.join(ROOT, "tools", script), ...args], { cwd: ROOT, timeout: 600000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
    cb({ ok: !err, out: String(stdout || "") + String(stderr || ""), code: err ? err.code : 0 });
  });
}

/* ── dados ────────────────────────────────────────────────────────────── */
function leads() {
  const dir = path.join(ROOT, "pipeline", "leads");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().reverse().slice(0, 5)
    .flatMap((f) => (read(path.join(dir, f), { items: [] }).items || []).map((it) => ({ ...it, file: f })));
}

function drafts() {
  const dir = path.join(ROOT, "pipeline", "drafts");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).map((slug) => {
    const d = path.join(dir, slug);
    const draft = read(path.join(d, "draft.json"));
    const review = readText(path.join(d, "review.md"));
    const score = read(path.join(d, "score.json"));
    const verdict = !draft ? "sem texto" : /REPROVADO/.test(review) ? "reprovado" : /APROVADO PARA PUBLICAÇÃO/.test(review) ? "aprovado" : "não checado";
    return {
      slug,
      id: draft ? draft.id : null,
      title: draft ? draft.title : (read(path.join(d, "brief.json"), {}) || {}).topic || slug,
      verdict,
      score: score ? score.score : null,
      note: score ? score.note : "",
      published: DB().articles.some((a) => draft && a.id === draft.id),
      mtime: fs.statSync(path.join(d, draft ? "draft.json" : "brief.json")).mtime.toISOString().slice(0, 16).replace("T", " "),
    };
  }).sort((a, b) => (a.published ? 1 : 0) - (b.published ? 1 : 0) || b.mtime.localeCompare(a.mtime));
}

function ranking() {
  const store = read(path.join(ROOT, "pipeline", "scores.json"), { scores: {} });
  const rows = DB().articles.map((a) => {
    const rec = store.scores[a.id] || {};
    return { id: a.id, title: a.title, category: a.category, date: a.date, score: typeof rec.score === "number" ? rec.score : null, note: rec.note || "", source: rec.source || "sem nota" };
  }).sort((x, y) => (y.score == null ? -1 : y.score) - (x.score == null ? -1 : x.score));
  const top = rows.find((r) => r.score != null);
  return { rows, cover: top && top.source !== "baseline" ? top : null, incumbent: rows.find((r) => r.source === "baseline" && DB().articles.find((a) => a.id === r.id && a.isHeroLead)) || null };
}

function logs() {
  const repDir = path.join(ROOT, "tools", "reports");
  const files = fs.existsSync(repDir) ? fs.readdirSync(repDir).filter((f) => f.endsWith(".md")).sort().reverse() : [];
  const stateDir = path.join(ROOT, "pipeline", "state");
  return {
    doctor: files.length ? { file: files[0], text: readText(path.join(repDir, files[0])).slice(0, 4000) } : null,
    publishLog: read(path.join(stateDir, "publish-log.json"), { days: {}, last: null }),
    seen: (read(path.join(stateDir, "seen.json"), { urls: [] }).urls || []).length,
    lastRuns: read(path.join(ROOT, "voice", "state", "last_runs.json"), { runs: {}, updated: null }),
  };
}

/* ── ações ────────────────────────────────────────────────────────────── */
const ACTIONS = {
  ingest: (q, cb) => run("ingest.js", [], cb),
  doctor: (q, cb) => run("doctor.js", ["--offline"], cb),
  brief: (q, cb) => (URL_OK(q.url) ? run("new-post.js", ["--url", q.url, ...(q.pillar ? ["--pillar", String(q.pillar).slice(0, 12)] : [])], cb) : cb({ ok: false, out: "url inválida" })),
  check: (q, cb) => (SLUG_OK(q.slug) ? run("check-post.js", [q.slug], cb) : cb({ ok: false, out: "slug inválido" })),
  score: (q, cb) => (SLUG_OK(q.slug) ? run("score.js", ["--draft", q.slug], cb) : cb({ ok: false, out: "slug inválido" })),
  publish: (q, cb) => (SLUG_OK(q.slug) ? run("publish.js", [q.slug, ...(q.force ? ["--force-cadence"] : [])], cb) : cb({ ok: false, out: "slug inválido" })),
  rank: (q, cb) => run("score.js", ["--rank"], cb),
  rescore: (q, cb) => run("score.js", ["--rescore"], cb),
  setscore: (q, cb) => {
    /* Nota manual: existe para você corrigir o robô, não para substituí-lo.
       Fica marcada como "manual" e o recálculo automático nunca a sobrescreve. */
    const id = String(q.id || "");
    const n = Number(q.score);
    const why = String(q.why || "").trim();
    if (!DB().articles.some((a) => a.id === id)) return cb({ ok: false, out: "id não está no catálogo" });
    if (!Number.isFinite(n) || n < 0 || n > 10) return cb({ ok: false, out: "nota precisa ser número de 0 a 10" });
    if (why.length < 15) return cb({ ok: false, out: "justificativa obrigatória (15+ caracteres) — sem ela a nota é chute" });
    const f = path.join(ROOT, "pipeline", "scores.json");
    const store = read(f, { scores: {} });
    store.scores[id] = { score: Math.round(n * 10) / 10, note: `${Math.round(n * 10) / 10}/10 — nota manual: ${why.slice(0, 200)}`, breakdown: { manual: { pts: Math.round(n * 10) / 10, max: 10, why } }, source: "manual", date: today() };
    store.updated = new Date().toISOString();
    fs.writeFileSync(f, JSON.stringify(store, null, 2) + "\n");
    run("build.js", [], (r1) => run("build-sitemap.js", [], () => cb({ ok: r1.ok, out: `nota ${Math.round(n * 10) / 10} gravada e feeds reconstruídos.\n${r1.out}` })));
  },
};

/* ── HTML ─────────────────────────────────────────────────────────────── */
function page() {
  const cad = read(path.join(ROOT, "pipeline", "cadence.json"), { max_publishes_per_day: 1, check_hours: [] });
  const L = logs();
  const done = (L.publishLog.days || {})[today()] || 0;
  const R = ranking();
  const D = drafts();
  const LE = leads();

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Painel · Homeworld Press</title>
<style>
:root{--bg:#0a0a0a;--panel:#141414;--line:#2a2a2a;--tx:#e8e6e3;--dim:#8a8a8a;--red:#ff2d20;--ok:#39d98a;--warn:#ffb020}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.55 ui-sans-serif,system-ui,"Segoe UI",Arial}
header{border-bottom:2px solid var(--red);padding:1rem 1.25rem;display:flex;gap:1rem;align-items:baseline;flex-wrap:wrap;position:sticky;top:0;background:var(--bg);z-index:5}
header h1{font-size:.95rem;letter-spacing:.14em;text-transform:uppercase;margin:0}
header .sub{color:var(--dim);font-size:.8rem}
main{padding:1.25rem;display:grid;gap:1.5rem;max-width:1200px}
section{background:var(--panel);border:1px solid var(--line);padding:1rem 1.1rem}
h2{font-size:.78rem;letter-spacing:.16em;text-transform:uppercase;margin:0 0 .85rem;color:var(--dim)}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th{text-align:left;color:var(--dim);font-weight:600;font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;padding:.4rem .5rem;border-bottom:1px solid var(--line)}
td{padding:.5rem;border-bottom:1px solid #1e1e1e;vertical-align:top}
tr:hover td{background:#191919}
.badge{display:inline-block;padding:.1rem .45rem;border:1px solid var(--line);font-size:.68rem;letter-spacing:.08em;text-transform:uppercase}
.b-cover{border-color:var(--red);color:var(--red)}
.b-ok{border-color:var(--ok);color:var(--ok)}
.b-bad{border-color:var(--red);color:var(--red)}
.b-wait{border-color:var(--warn);color:var(--warn)}
.b-dim{color:var(--dim)}
button{background:#1f1f1f;color:var(--tx);border:1px solid #3a3a3a;padding:.32rem .7rem;font:600 .74rem/1 ui-sans-serif,system-ui;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}
button:hover:not(:disabled){border-color:var(--red);color:var(--red)}
button:disabled{opacity:.35;cursor:not-allowed}
button.go{border-color:var(--red);color:var(--red)}
input,select{background:#0d0d0d;border:1px solid #333;color:var(--tx);padding:.3rem .45rem;font:13px ui-sans-serif,system-ui}
pre{background:#0d0d0d;border:1px solid var(--line);padding:.7rem;overflow:auto;max-height:280px;font:12px/1.5 ui-monospace,"Cascadia Mono",Consolas,monospace;white-space:pre-wrap;word-break:break-word}
.grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.stat{border:1px solid var(--line);padding:.7rem .8rem}
.stat b{display:block;font-size:1.5rem;line-height:1.1}
.stat span{color:var(--dim);font-size:.7rem;letter-spacing:.1em;text-transform:uppercase}
.note{color:var(--dim);font-size:.78rem}
a{color:var(--tx)}
#out{display:none}
.row{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
</style></head>
<body>
<header>
  <h1>Homeworld Press · Painel</h1>
  <span class="sub">127.0.0.1 somente · ${esc(new Date().toLocaleString("pt-BR"))}</span>
  <span class="sub" style="margin-left:auto">publicações hoje: <strong>${done}/${cad.max_publishes_per_day}</strong> · verificações/dia: ${cad.checks_per_day || cad.check_hours.length}</span>
</header>
<main>
  <section>
    <h2>Estado do robô</h2>
    <div class="grid">
      <div class="stat"><span>matérias no ar</span><b>${DB().articles.length}</b></div>
      <div class="stat"><span>capa atual</span><b style="font-size:.9rem">${esc(R.cover ? R.cover.title : (R.incumbent ? R.incumbent.title : "manual"))}</b><span class="note">${R.cover ? "escolhida por nota" : "capa escrita à mão — nenhuma matéria venceu a nota de base"}</span></div>
      <div class="stat"><span>rascunhos esperando</span><b>${D.filter((d) => !d.published && d.verdict !== "sem texto").length}</b></div>
      <div class="stat"><span>pautas coletadas</span><b>${LE.length}</b><span class="note">${L.seen} urls já vistas</span></div>
    </div>
    <p class="row" style="margin-top:.9rem">
      <button data-act="ingest">Rodar coleta agora</button>
      <button data-act="doctor">Rodar manutenção (doctor)</button>
      <button data-act="rescore">Recalcular notas</button>
      <button data-act="rank">Ver ranking</button>
      <span class="note">O agendador do Qoder já faz isso ${cad.checks_per_day || 5}x por dia; estes botões são para adiantar.</span>
    </p>
  </section>

  <section>
    <h2>Rascunhos</h2>
    ${D.length ? `<table><thead><tr><th>matéria</th><th>estado</th><th>nota</th><th>ações</th></tr></thead><tbody>
    ${D.map((d) => `<tr>
      <td><strong>${esc(d.title)}</strong><br><span class="note">${esc(d.slug)} · ${esc(d.mtime)}</span></td>
      <td>${d.published ? '<span class="badge b-dim">publicada</span>' : `<span class="badge ${d.verdict === "aprovado" ? "b-ok" : d.verdict === "reprovado" ? "b-bad" : "b-wait"}">${esc(d.verdict)}</span>`}</td>
      <td>${d.score == null ? "—" : `<strong>${d.score}</strong><br><span class="note">${esc(d.note.slice(0, 90))}</span>`}</td>
      <td class="row">
        <button data-act="check" data-slug="${esc(d.slug)}">checar</button>
        <button class="go" data-act="publish" data-slug="${esc(d.slug)}" ${d.verdict === "aprovado" && !d.published ? "" : "disabled"}>publicar</button>
        ${done >= cad.max_publishes_per_day && !d.published ? '<button data-act="publish" data-slug="' + esc(d.slug) + '" data-force="1">forçar</button>' : ""}
      </td></tr>`).join("")}
    </tbody></table>` : "<p class='note'>Nenhum rascunho. A coleta gera as pautas abaixo; o robô cria o brief e escreve o texto.</p>"}
  </section>

  <section>
    <h2>Pautas coletadas (feeds gratuitos)</h2>
    ${LE.length ? `<table><thead><tr><th>título</th><th>fonte</th><th>pilar</th><th></th></tr></thead><tbody>
    ${LE.slice(0, 25).map((l) => `<tr>
      <td><a href="${esc(l.link)}" target="_blank" rel="noopener">${esc(l.title)}</a><br><span class="note">${esc((l.description || "").slice(0, 150))}</span></td>
      <td class="note">${esc(new URL(l.link).hostname.replace("www.", ""))}<br>${esc(String(l.pubDate || "").slice(0, 16))}</td>
      <td><span class="badge">${esc(l.pillar || "?")}</span><br><span class="note">${l.score != null ? "relevância " + l.score : ""}</span></td>
      <td><button data-act="brief" data-url="${esc(l.link)}">criar brief</button></td></tr>`).join("")}
    </tbody></table>` : '<p class="note">Nada coletado ainda. Use o botão Rodar coleta agora.</p>'}
  </section>

  <section>
    <h2>Ranking de notas — a maior vai para a capa</h2>
    <p class="note">A nota é calculada por tools/score.js a partir de fontes, atualidade, novidade, ritmo medido e encaixe comercial. O modelo contribui com no máximo 1,0 ponto de julgamento. Nota manual sua fica marcada e nunca é sobrescrita.</p>
    <table><thead><tr><th>#</th><th>nota</th><th>matéria</th><th>origem</th><th>ajuste manual</th></tr></thead><tbody>
    ${R.rows.slice(0, 25).map((r, i) => `<tr>
      <td>${i === 0 && R.cover ? '<span class="badge b-cover">capa</span>' : i + 1}</td>
      <td><strong>${r.score == null ? "—" : r.score}</strong></td>
      <td>${esc(r.title)}<br><span class="note">${esc(r.id)} · ${esc(r.date)} · <a href="article.html?id=${esc(r.id)}" target="_blank">ver</a></span><br><span class="note">${esc(r.note.slice(0, 130))}</span></td>
      <td><span class="badge ${r.source === "auto" ? "b-ok" : r.source === "manual" ? "b-wait" : "b-dim"}">${esc(r.source)}</span></td>
      <td><span class="row"><input type="number" step="0.1" min="0" max="10" placeholder="0–10" style="width:5.5rem" id="n-${esc(r.id)}"><input type="text" placeholder="por quê (obrigatório)" style="width:14rem" id="w-${esc(r.id)}"><button data-act="setscore" data-id="${esc(r.id)}">gravar</button></span></td>
    </tr>`).join("")}
    </tbody></table>
  </section>

  <section>
    <h2>Logs</h2>
    <div class="grid">
      <div><h2>Último doctor${L.doctor ? " · " + esc(L.doctor.file) : ""}</h2><pre>${esc(L.doctor ? L.doctor.text : "nunca rodou")}</pre></div>
      <div><h2>Memória anti-repetição</h2><pre>${esc(JSON.stringify(L.lastRuns, null, 2))}</pre><h2>Histórico de publicação</h2><pre>${esc(JSON.stringify(L.publishLog, null, 2))}</pre></div>
    </div>
  </section>

  <section id="out"><h2>Resultado</h2><pre id="outtext"></pre></section>
</main>
<script>
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-act]");
  if (!b) return;
  const act = b.dataset.act;
  const p = new URLSearchParams({ act });
  if (b.dataset.slug) p.set("slug", b.dataset.slug);
  if (b.dataset.url) p.set("url", b.dataset.url);
  if (b.dataset.force) p.set("force", "1");
  if (act === "setscore") {
    p.set("id", b.dataset.id);
    p.set("score", document.getElementById("n-" + b.dataset.id).value);
    p.set("why", document.getElementById("w-" + b.dataset.id).value);
  }
  b.disabled = true; const old = b.textContent; b.textContent = "rodando…";
  fetch("/api?" + p.toString()).then((r) => r.json()).then((j) => {
    document.getElementById("out").style.display = "block";
    document.getElementById("outtext").textContent = (j.ok ? "OK · " : "FALHOU · ") + act + "\\n\\n" + j.out;
    setTimeout(() => location.reload(), 900);
  }).catch((e) => { b.disabled = false; b.textContent = old; alert(String(e)); });
});
</script>
</body></html>`;
}

/* ── servidor ─────────────────────────────────────────────────────────── */
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${HOST}:${PORT}`);
  if (u.pathname === "/api") {
    const act = u.searchParams.get("act");
    const q = Object.fromEntries(u.searchParams);
    const done = (r) => { res.writeHead(200, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(r)); };
    if (!ACTIONS[act]) return done({ ok: false, out: "ação desconhecida: " + act });
    /* Sem shell: só arrays de argumentos, com slug/url validados acima. */
    return ACTIONS[act](q, done);
  }
  if (u.pathname === "/" || u.pathname === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(page());
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("404");
});

server.listen(PORT, HOST, () => {
  console.log(`painel: http://${HOST}:${PORT}`);
  console.log("visível só nesta máquina. Ctrl+C para derrubar.");
});
