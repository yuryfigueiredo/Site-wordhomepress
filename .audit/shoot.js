/* shoot.js — screenshot headless reutilizável (auditoria, não faz parte do site)
   uso: node .audit/shoot.js <url> <arquivo.png> [largura] [altura] [fullPage] */
const { spawn } = require("child_process");
const PORT = Number(process.env.CDP_PORT || 9341);
const [URL, OUT, W = "1360", H = "900", FULL = "0"] = process.argv.slice(2);
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, "--user-data-dir=C:/Users/Yury/AppData/Local/Temp/hwp-shoot", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let list;
  for (let i = 0; i < 40; i++) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.length) break; } catch {} await sleep(250); }
  const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
  let id = 0; const p = new Map();
  const send = (m, q = {}) => new Promise((res, rej) => { const i = ++id; p.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: q })); });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: Number(W), height: Number(H), deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: URL });
  await sleep(2600);
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: FULL === "1" });
  require("fs").writeFileSync(OUT, Buffer.from(shot.data, "base64"));
  console.log("gravado:", OUT);
  ws.close(); chrome.kill(); process.exit(0);
})();
