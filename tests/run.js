#!/usr/bin/env node
/*
 * Integration tests for Cozy Cat Café Run's frame-stepping.
 * Loads the REAL index.html in Chrome (via DevTools Protocol) and drives the
 * exposed window.__cozy.advance() deterministically to verify the stutter fix:
 *
 *   1. No frozen frames at 120Hz   — every displayed frame moves the world
 *      (the actual cause of the judder the user reported on a ProMotion display).
 *   2. Frame-rate independence      — 1s of play covers ~the same distance at
 *      30 / 60 / 120 Hz, so feel doesn't change with refresh rate.
 *   3. Sub-stepping is tunnel-safe  — large frames split into <=1-unit steps.
 *   4. Refocus gaps are clamped     — a multi-second stall can't fast-forward.
 *   5. Input produces motion        — a jump gets the cat airborne.
 *   6. No console errors / exceptions while running.
 */
const { spawn } = require('child_process');
const fs = require('fs');

const CHROME = process.env.CHROME_BIN ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const GAME_URL = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const PORT = 9333;

const TEST = `(function(){
  var z=window.__cozy; if(!z) return JSON.stringify({error:'__cozy missing'});
  var out={};
  function dist(){return z.S.dist;}

  // 1. No frozen frames @120Hz (0.5 units/frame)
  z.setChar(0); z.start();
  var f120=1000/120, prev=dist(), frozen=0, maxSub=0;
  for(var i=0;i<90;i++){ var n=z.advance(f120); var d=dist(); if(d<=prev) frozen++; prev=d; if(n>maxSub)maxSub=n; }
  out.frozen120=frozen; out.maxSub120=maxSub;

  // 2. Frame-rate independence over 1 wall-clock second
  z.start(); for(var i=0;i<120;i++) z.advance(1000/120); out.d120=dist();
  z.start(); for(var i=0;i<60;i++)  z.advance(1000/60);  out.d60=dist();
  z.start(); for(var i=0;i<30;i++)  z.advance(1000/30);  out.d30=dist();

  // 3. Tunnel-safety: 50ms (3 units) -> 3 sub-steps
  z.start(); out.bigSub=z.advance(50);

  // 4. Clamp: a 5s stall is capped to 100ms (6 units) -> 6 sub-steps
  z.start(); out.hugeSub=z.advance(5000);

  // 5. Input -> motion: jump gets the cat well off the ground
  z.start(); z.jump(); var miny=0;
  for(var i=0;i<28;i++){ z.advance(1000/60); if(z.p.y<miny) miny=z.p.y; }
  out.jumpY=miny;

  return JSON.stringify(out);
})()`;

function approxEq(a, b, tol){ return Math.abs(a - b) <= tol * Math.abs(b); }

async function main(){
  if(!fs.existsSync(CHROME)){ console.error('Chrome not found at', CHROME, '(set CHROME_BIN)'); process.exit(2); }
  const profile = '/tmp/cozy-test-profile';
  fs.rmSync(profile, { recursive: true, force: true });
  const chrome = spawn(CHROME, [
    '--headless', '--no-sandbox', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', GAME_URL
  ], { stdio: 'ignore' });

  let ws, target;
  try {
    for(let i=0;i<60;i++){
      try{
        const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
        target = list.find(t => t.type==='page' && t.url.startsWith('file:'));
        if(target && target.webSocketDebuggerUrl) break;
      }catch(e){}
      await new Promise(r=>setTimeout(r,250));
    }
    if(!target) throw new Error('no page target');

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res,rej)=>{ ws.onopen=res; ws.onerror=()=>rej(new Error('ws error')); });

    let id=0; const pending={}; const errors=[];
    ws.onmessage = (ev)=>{
      const m = JSON.parse(ev.data);
      if(m.id && pending[m.id]){ pending[m.id](m); delete pending[m.id]; }
      if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text || 'exception');
      if(m.method==='Runtime.consoleAPICalled' && m.params.type==='error')
        errors.push((m.params.args||[]).map(a=>a.value).join(' '));
    };
    const send=(method,params)=> new Promise(res=>{ const mid=++id; pending[mid]=res; ws.send(JSON.stringify({id:mid,method,params:params||{}})); });

    await send('Runtime.enable');
    // CDP Runtime.evaluate result lives at response.result.result.value
    const evalValue = (resp)=> resp && resp.result && resp.result.result && resp.result.result.value;
    // wait for the game to boot and expose __cozy
    let booted=false;
    for(let i=0;i<40;i++){
      const r = await send('Runtime.evaluate',{expression:'!!(window.__cozy && window.__cozy.advance)', returnByValue:true});
      if(evalValue(r)===true){ booted=true; break; }
      await new Promise(r=>setTimeout(r,100));
    }
    if(!booted) throw new Error('__cozy.advance never appeared');

    const r = await send('Runtime.evaluate',{expression:TEST, returnByValue:true});
    if(r.result && r.result.exceptionDetails) throw new Error('test eval threw: '+r.result.exceptionDetails.text);
    const o = JSON.parse(evalValue(r));
    if(o.error) throw new Error('in-page: '+o.error);

    // ---- assertions ----
    const results = [];
    const check = (name, pass, detail)=>{ results.push({name,pass,detail}); };

    check('no frozen frames @120Hz', o.frozen120===0, `frozen=${o.frozen120}/90`);
    check('one sub-step per 120Hz frame', o.maxSub120===1, `maxSub=${o.maxSub120}`);
    check('60Hz vs 120Hz distance match', approxEq(o.d120,o.d60,0.01), `d120=${o.d120.toFixed(2)} d60=${o.d60.toFixed(2)}`);
    check('60Hz vs 30Hz distance match', approxEq(o.d30,o.d60,0.01), `d30=${o.d30.toFixed(2)} d60=${o.d60.toFixed(2)}`);
    check('50ms frame -> 3 sub-steps', o.bigSub===3, `subSteps=${o.bigSub}`);
    check('5s stall clamped to 6 sub-steps', o.hugeSub===6, `subSteps=${o.hugeSub}`);
    check('jump produces airborne motion', o.jumpY < -50, `minY=${o.jumpY.toFixed(1)}`);
    check('no console errors / exceptions', errors.length===0, errors.join(' | ') || 'none');

    let failed=0;
    console.log('\nCat Run — stutter-fix tests\n');
    for(const r of results){
      console.log(`  ${r.pass?'\x1b[32m✓\x1b[0m':'\x1b[31m✗\x1b[0m'} ${r.name}  \x1b[2m(${r.detail})\x1b[0m`);
      if(!r.pass) failed++;
    }
    console.log(`\n${failed===0?'\x1b[32mALL PASS\x1b[0m':('\x1b[31m'+failed+' FAILED\x1b[0m')} (${results.length} checks)\n`);

    ws.close();
    chrome.kill();
    process.exit(failed===0?0:1);
  } catch(e){
    console.error('TEST HARNESS ERROR:', e.message);
    try{ ws && ws.close(); }catch(_){}
    chrome.kill();
    process.exit(2);
  }
}
main();
