const { spawn } = require('child_process');
const PORT=9336;
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu',`--remote-debugging-port=${PORT}`,'--user-data-dir=C:/Users/Yury/AppData/Local/Temp/hwp-cdp4','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{let list;for(let i=0;i<40;i++){try{list=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();if(list.length)break;}catch(e){}await sleep(250);}
const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const p=new Map();
const send=(m,q={})=>new Promise((res,rej)=>{const i=++id;p.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:q}));});
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&p.has(m.id)){const{res,rej}=p.get(m.id);p.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};
await new Promise(r=>ws.onopen=r);await send('Page.enable');
await send('Page.navigate',{url:'http://127.0.0.1:8080/index.html'});await sleep(1500);
const {result}=await send('Runtime.evaluate',{expression:`(()=>{const k=document.querySelector('.kicker--culture');const s=getComputedStyle(k);const b=getComputedStyle(k.closest('.pick-item'));return JSON.stringify({color:s.color,size:s.fontSize,weight:s.fontWeight,bg:b.backgroundColor,bodyBg:getComputedStyle(document.body).backgroundColor,txt:k.textContent.trim().slice(0,30)})})()`,returnByValue:true});
console.log(result.value);ws.close();chrome.kill();})();
