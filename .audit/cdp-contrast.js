const { spawn } = require('child_process');
const PORT = 9335;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new','--disable-gpu',`--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:/Users/Yury/AppData/Local/Temp/hwp-cdp3','about:blank'
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let list;
  for (let i=0;i<40;i++){ try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if(list.length) break; } catch(e){} await sleep(250); }
  const ws = new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);
  let id=0; const pending=new Map();
  const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;pending.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});
  ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){const{res,rej}=pending.get(m.id);pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};
  await new Promise(r=>ws.onopen=r);
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  const expr = `(() => {
    const lum = c => { const v=c.map(x=>{x/=255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4)}); return 0.2126*v[0]+0.7152*v[1]+0.0722*v[2]; };
    const parse = s => (s.match(/[\d.]+/g)||[]).map(Number);
    const bgOf = el => { let e=el; while(e && e!==document.documentElement){ const b=getComputedStyle(e).backgroundColor; const p=parse(b); if(p.length>=3 && (p[3]===undefined||p[3]>0.9)) return p.slice(0,3); e=e.parentElement; } return [247,246,242]; };
    const fails={};
    document.querySelectorAll('body *').forEach(el=>{
      const st=getComputedStyle(el);
      if(st.visibility==='hidden'||st.display==='none'||Number(st.opacity)===0) return;
      const hasText=[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim().length>1);
      if(!hasText) return;
      const r=el.getBoundingClientRect(); if(r.width<=0||r.height<=0) return;
      const fg=parse(st.color).slice(0,3), bg=bgOf(el);
      const L1=lum(fg), L2=lum(bg); const ratio=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
      const size=parseFloat(st.fontSize), weight=parseInt(st.fontWeight)||400;
      const large=size>=24||(size>=18.66&&weight>=700);
      const need=large?3:4.5;
      if(ratio<need){
        const key=st.color+' on '+bg.join(',')+' @'+size+'px/'+weight+' = '+ratio.toFixed(2);
        fails[key]=(fails[key]||0)+1;
      }
    });
    return JSON.stringify(fails,null,1);
  })()`;
  for(const mode of ['light','dark']){
    console.log('\n=== '+mode.toUpperCase()+' ===');
    for(const p of ['index.html','culture.html','reviews.html','review.html?id=best-ereaders-2026','article.html?id=solid-state-batteries-portable-power-future','dumarest/index.htm']){
      await send('Page.navigate',{url:'http://127.0.0.1:8080/'+p});
      await sleep(900);
      await send('Runtime.evaluate',{expression:`document.documentElement.setAttribute('data-theme','${mode}')`});
      await sleep(250);
      const {result}=await send('Runtime.evaluate',{expression:expr,returnByValue:true});
      console.log('-- '+p+' '+result.value.replace(/\n/g,' '));
    }
  }
  ws.close(); chrome.kill();
})();
