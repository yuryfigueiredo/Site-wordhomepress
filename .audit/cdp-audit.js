const { spawn } = require('child_process');
const PORT = 9334;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new','--disable-gpu',`--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:/Users/Yury/AppData/Local/Temp/hwp-cdp2','about:blank'
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let list;
  for (let i=0;i<40;i++){ try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if(list.length) break; } catch(e){} await sleep(250); }
  const target = list.find(t=>t.type==='page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id=0; const pending=new Map();
  const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;pending.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});
  ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){const{res,rej}=pending.get(m.id);pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};
  await new Promise(r=>ws.onopen=r);
  await send('Page.enable'); await send('Runtime.enable');

  const pages=['index.html','culture.html','tech.html','science.html','reviews.html','archive.html','article.html?id=brandon-sanderson-sci-fi-publishing-empire-2026','review.html?id=best-ereaders-2026','chance.htm','tarzan-centennial.html','classic-comics.html','dumarest/index.htm'];
  const widths=[[390,844,'mobile'],[768,1024,'tablet'],[1440,900,'desktop']];
  const expr = `(() => {
    const vw = document.documentElement.clientWidth;
    const over = [...document.querySelectorAll('body *')].filter(el=>{
      const r=el.getBoundingClientRect();
      if(r.width<=0||r.right<=vw+1) return false;
      return !el.closest('.wired-substrip__inner, .table-wrapper, [style*="overflow-x"], .search-modal, dialog');
    }).map(el=>({t:el.tagName,c:(el.className||'').toString().slice(0,40),r:Math.round(el.getBoundingClientRect().right)})).slice(0,6);
    const h1s=[...document.querySelectorAll('h1')].map(h=>h.textContent.trim().slice(0,50));
    const dlg=document.querySelectorAll('dialog').length;
    const imgs=[...document.images].filter(i=>!i.alt).length;
    const main=document.querySelectorAll('main').length;
    const skip=document.querySelectorAll('.skip-link').length;
    const inputs=[...document.querySelectorAll('input')].filter(i=>!i.labels?.length&&!i.getAttribute('aria-label')&&!i.getAttribute('aria-labelledby')).length;
    const dupes=(()=>{const seen={},d=[];document.querySelectorAll('[id]').forEach(e=>{seen[e.id]=(seen[e.id]||0)+1});for(const k in seen)if(seen[k]>1)d.push(k);return d;})();
    const smallLinks=[...document.querySelectorAll('a,button')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.height<24}).length;
    return JSON.stringify({vw,scrollW:document.documentElement.scrollWidth,over,h1:h1s,main,skip,inputsUnlabeled:inputs,imgsNoAlt:imgs,dupes,smallTargets:smallLinks});
  })()`;
  for(const w of widths){
    await send('Emulation.setDeviceMetricsOverride',{width:w[0],height:w[1],deviceScaleFactor:1,mobile:w[0]<800});
    console.log('\n### '+w[2]+' '+w[0]);
    for(const p of pages){
      await send('Page.navigate',{url:'http://127.0.0.1:8080/'+p});
      await sleep(1400);
      const {result}=await send('Runtime.evaluate',{expression:expr,returnByValue:true});
      const d=JSON.parse(result.value); const issues=[];
      if(d.scrollW>d.vw) issues.push('SCROLLW '+d.scrollW);
      if(d.over.length) issues.push('OVER '+JSON.stringify(d.over));
      if(d.h1.length!==1) issues.push('H1='+d.h1.length);
      if(!d.main) issues.push('NO-MAIN');
      if(!d.skip) issues.push('NO-SKIP');
      if(d.inputsUnlabeled) issues.push('UNLABELED-INPUT '+d.inputsUnlabeled);
      if(d.imgsNoAlt) issues.push('NO-ALT '+d.imgsNoAlt);
      if(d.dupes.length) issues.push('DUP-ID '+d.dupes);
      console.log(p.padEnd(58), issues.length?issues.join(' | '):'ok');
    }
  }
  ws.close(); chrome.kill();
})();
