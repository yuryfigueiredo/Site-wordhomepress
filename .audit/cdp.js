const { spawn } = require('child_process');
const PORT = 9333;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new','--disable-gpu',`--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:/Users/Yury/AppData/Local/Temp/hwp-cdp','about:blank'
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let list;
  for (let i=0;i<40;i++){ try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if(list.length) break; } catch(e){} await sleep(250); }
  const target = list.find(t=>t.type==='page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id=0; const pending=new Map();
  const send=(method,params={})=>new Promise((res,rej)=>{const i=++id;pending.set(i,{res,rej});ws.send(JSON.stringify({id:i,method,params}));});
  ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){const{res,rej}=pending.get(m.id);pending.delete(m.id); m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};
  await new Promise(r=>ws.onopen=r);
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
  await send('Page.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:8080/index.html'});
  await sleep(2500);
  const expr = `(() => {
    const vw = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll('body *')].map(el=>{
      const r = el.getBoundingClientRect();
      return {tag: el.tagName, cls: (el.className && el.className.toString().slice(0,60)) || '', right: Math.round(r.right), width: Math.round(r.width)};
    }).filter(o=>o.right > vw + 1 && o.width > 0).slice(0,25);
    return JSON.stringify({vw, innerWidth: window.innerWidth, scrollW: document.documentElement.scrollWidth, offenders}, null, 1);
  })()`;
  const {result} = await send('Runtime.evaluate',{expression:expr,returnByValue:true});
  console.log(result.value);
  ws.close(); chrome.kill();
})();
