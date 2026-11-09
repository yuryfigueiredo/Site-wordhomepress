/* secao.js — frame de uma seção específica, com a régua do vão medida no browser.
   uso: node .audit/secao.js <arquivo.html> <seletor> <saida.png> <largura> [altura]
   O clip precisa estar dentro do viewport (screenshot com clip fora dá erro),
   então o viewport é alto e a página é rolada até o topo do elemento. */
const path = require("path");
const fs = require("fs");
const { chromium } = require("C:/Users/Yury/pw-check/node_modules/playwright-core");
const ROOT = path.resolve(__dirname, "..");

const [file, sel, out, W = "1440", H = "1700"] = process.argv.slice(2);

(async () => {
  const browser = await chromium.launch({ executablePath: "C:/Users/Yury/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe" });
  const page = await browser.newPage({ viewport: { width: Number(W), height: Number(H) } });
  await page.goto("file:///" + path.join(ROOT, file).replace(/\\/g, "/"));
  await page.waitForTimeout(600);
  const box = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    /* topo absoluto pela própria caixa: offsetTop erra com ancestral em
       position:fixed, e aí o clip cai fora do que o viewport renderiza. */
    const topo = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, topo - 8));
    return { topo };
  }, sel);
  if (!box) throw new Error(`seletor não encontrado: ${sel}`);
  await page.waitForTimeout(400);
  const r = await page.evaluate((s) => {
    const el = document.querySelector(s);
    const b = el.getBoundingClientRect();
    return { x: Math.max(0, Math.round(b.x)), y: Math.max(0, Math.round(b.y)), w: Math.round(b.width), h: Math.round(b.height), docH: document.documentElement.scrollHeight, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
  }, sel);
  /* O clip é relativo ao viewport já rolado: y=0 é o topo da seção, e a altura
     nunca passa do que a janela renderiza (clip além disso = "outside the
     resulting image"). Seção mais alta que a janela sai cortada de propósito. */
  const altura = Math.max(1, Math.min(r.h + r.y, Number(H) - 24));
  await page.screenshot({ path: out, clip: { x: r.x, y: 0, width: Math.min(r.w, Number(W)), height: altura } });
  /* o vão abaixo do último card, dentro da mesma grade. "Último" é o mais
     BAIXO, não o último no DOM: na grade de 3 colunas o artigo que fecha o
     documento não é o que fecha a coluna. */
  const vao = await page.evaluate((s) => {
    const el = document.querySelector(s);
    const cards = [...el.querySelectorAll("article")];
    if (!cards.length) return null;
    const fundo = Math.max(...cards.map((c) => c.getBoundingClientRect().bottom));
    const grade = (cards[0].parentElement || el).getBoundingClientRect();
    return { cards: cards.length, vaoAbaixo: Math.round(grade.bottom - fundo), alturaGrade: Math.round(grade.height) };
  }, sel);
  console.log(`${file} · ${sel} → ${out}`);
  console.log(`  cards: ${vao && vao.cards} · vão abaixo do último: ${vao && vao.vaoAbaixo}px · grade: ${vao && vao.alturaGrade}px`);
  console.log(`  scroll horizontal: ${r.scrollW > r.clientW ? `SIM (${r.scrollW - r.clientW}px)` : "não"} · altura do documento: ${r.docH}px`);
  await browser.close();
})();
