/* Verificação pós-correção via CDP: node .audit/verify.js [desktop|mobile] */
const { spawn } = require("child_process");
const PORT = 9341;
const MODE = process.argv[2] === "mobile" ? "mobile" : "desktop";
const VP = MODE === "mobile" ? { width: 375, height: 780 } : { width: 1440, height: 900 };

global.window = {};
require("../js/articles-db.js");
const DB = global.window.HWP_DATABASE;

const URLS = [
  "http://127.0.0.1:8080/index.html",
  "http://127.0.0.1:8080/culture.html",
  "http://127.0.0.1:8080/tech.html",
  "http://127.0.0.1:8080/science.html",
  "http://127.0.0.1:8080/reviews.html",
  "http://127.0.0.1:8080/archive.html",
  "http://127.0.0.1:8080/disclosure.html",
  "http://127.0.0.1:8080/404.html",
  "http://127.0.0.1:8080/dumarest/index.htm",
  "http://127.0.0.1:8080/chance.htm",
  "http://127.0.0.1:8080/tarzan-centennial.html",
  "http://127.0.0.1:8080/classic-comics.html",
  ...DB.articles.map((a) => `http://127.0.0.1:8080/article.html?id=${encodeURIComponent(a.id)}`),
  ...DB.reviews.map((r) => `http://127.0.0.1:8080/review.html?id=${encodeURIComponent(r.id)}`),
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROBE = `(() => {
  const meta = (sel) => (document.querySelector(sel) || {}).content || null;
  const link = (rel) => (document.querySelector('link[rel="'+rel+'"]') || {}).href || null;
  const unlabelled = [...document.querySelectorAll('input')].filter(i => !i.getAttribute('aria-label') && !(i.id && document.querySelector('label[for="'+i.id+'"]'))).length;
  const unnamedBtns = [...document.querySelectorAll('button')].filter(b => !(b.textContent||'').trim() && !b.getAttribute('aria-label')).length;
  const brokenImgs = [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.currentSrc || i.src);
  const offenders = [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1).slice(0,3).map(el => el.className || el.tagName);
  return JSON.stringify({
    lang: document.documentElement.lang,
    title: document.title.slice(0,70),
    desc: !!meta('meta[name="description"]'),
    canonical: link('canonical'),
    ogTitle: meta('meta[property="og:title"]'),
    ogImage: meta('meta[property="og:image"]'),
    twCard: meta('meta[name="twitter:card"]'),
    favicon: !!document.querySelector('link[rel="icon"]'),
    jsonld: !!document.querySelector('script[type="application/ld+json"]'),
    jsonldOk: (() => {
      const el = document.querySelector('script[type="application/ld+json"]');
      if (!el) return true;
      try { JSON.parse(el.textContent); return true; } catch (err) { return String(err.message).slice(0, 60); }
    })(),
    h1: document.querySelectorAll('h1').length,
    ariaCurrent: document.querySelectorAll('[aria-current="page"]').length,
    unlabelled, unnamedBtns, brokenImgs,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    offenders,
    disclosureLink: !!document.querySelector('a[href$="disclosure.html"]'),
    skipLink: !!document.querySelector('.skip-link'),
    mainId: !!document.querySelector('main#main-content'),
  });
})()`;

(async () => {
  const chrome = spawn(
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=C:/Users/Yury/AppData/Local/Temp/hwp-verify-${Date.now()}`, "about:blank"],
    { stdio: "ignore" }
  );
  let list;
  for (let i = 0; i < 60; i++) {
    try {
      list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      if (list.length) break;
    } catch (e) {}
    await sleep(250);
  }
  const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };
  const errors = [];
  const failed = [];
  ws.addEventListener?.("message", () => {});
  await new Promise((r) => (ws.onopen = r));

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Log.enable");
  ws.onmessage = ((original) => (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method === "Network.loadingFailed") failed.push(msg.params.errorText);
    if (msg.method === "Network.responseReceived" && msg.params.response.status >= 400)
      failed.push(`${msg.params.response.status} ${msg.params.response.url.slice(-45)}`);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error")
      errors.push(msg.params.args.map((a) => a.value || a.description).join(" "));
    original(e);
  })(ws.onmessage);

  await send("Emulation.setDeviceMetricsOverride", { ...VP, deviceScaleFactor: 1, mobile: MODE === "mobile" });

  const rows = [];
  for (const url of URLS) {
    errors.length = 0;
    failed.length = 0;
    await send("Page.navigate", { url });
    await sleep(1400);
    const { result } = await send("Runtime.evaluate", { expression: PROBE, returnByValue: true });
    const r = JSON.parse(result.value);
    rows.push({ url: url.replace("http://127.0.0.1:8080/", ""), ...r, consoleErrors: errors.length ? errors : "", netFail: failed.length ? [...new Set(failed)] : "" });
  }

  console.log(`\n=== ${MODE.toUpperCase()} ${VP.width}x${VP.height} ===`);
  for (const r of rows) {
    const noindex = /404\.html/.test(r.url);
    const problems = [];
    if (r.lang !== "en-US") problems.push(`lang=${r.lang}`);
    if (r.h1 !== 1) problems.push(`h1=${r.h1}`);
    if (!r.canonical) problems.push("no canonical");
    if (!noindex && !r.ogTitle) problems.push("no og:title");
    if (!noindex && !r.ogImage) problems.push("no og:image");
    if (!noindex && !r.twCard) problems.push("no twitter:card");
    if (r.ogImage && !/^https:\/\//.test(r.ogImage)) problems.push(`og:image not absolute: ${r.ogImage}`);
    if (!r.favicon) problems.push("no favicon");
    if (r.jsonldOk !== true) problems.push(`JSON-LD parse error: ${r.jsonldOk}`);
    if (r.unlabelled) problems.push(`${r.unlabelled} unlabelled input(s)`);
    if (r.unnamedBtns) problems.push(`${r.unnamedBtns} unnamed button(s)`);
    if (r.overflow) problems.push(`OVERFLOW ${JSON.stringify(r.offenders)}`);
    if (r.brokenImgs.length) problems.push(`broken img ${r.brokenImgs.join(",")}`);
    if (r.consoleErrors) problems.push(`console: ${r.consoleErrors}`);
    if (r.netFail) problems.push(`net: ${r.netFail.join(" | ")}`);
    if (!r.skipLink) problems.push("no skip link");
    if (!r.mainId) problems.push("no main#main-content");
    console.log(`${problems.length ? "FAIL" : " ok "} ${r.url.padEnd(62)} ${problems.join("; ")}`);
  }
  ws.close();
  chrome.kill();
})();
