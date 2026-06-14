#!/usr/bin/env node
/*
 * Gameplay-correctness tests for Cat Run.
 * Loads the REAL index.html in headless Chrome (DevTools Protocol) and drives
 * window.__cozy deterministically — injecting obstacles at known positions — to
 * verify the rules that actually shape the player's experience:
 *
 *   collisions kill · jumping clears ground hazards · flyers require a duck ·
 *   fish are a bonus (never fatal) · score climbs · pause freezes the world ·
 *   high-score only ever goes up · character swap wraps + persists ·
 *   ducking is not a dodge for ground hazards ·
 *   and — the anti-judder guarantee — a fast obstacle in one big frame is still
 *   caught (sub-stepping), and the outcome is identical however the elapsed time
 *   is chunked (frame-rate-independent collision).
 *
 * Logic-only, so headless rendering (no color-emoji) is fine here.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME_BIN ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const GAME_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const PORT = 9334;

const TEST = `(function(){
  var z=window.__cozy; if(!z||!z.geom) return JSON.stringify({error:'__cozy/geom missing'});
  var out={}; var GY=z.geom().GY;
  function clearInject(o){ z.obs.length=0; if(o) z.obs.push(o); }
  function ground(x,r){ return {x:x,kind:'ground',e:'🧶',r:r||18,y:GY-(r||18),passed:false}; }
  function fly(x){ return {x:x,kind:'fly',e:'🦋',r:15,y:GY-52,passed:false}; }
  function fish(x){ return {x:x,kind:'fish',e:'🐟',r:15,y:GY-40,grabbed:false,passed:false}; }
  function runUntilOver(maxF){ for(var i=0;i<maxF;i++){ z.advance(1000/60); if(z.S.phase==='over') return true; } return false; }

  // 1. a ground hazard you don't jump = death
  z.setChar(0); z.start(); clearInject(ground(200));
  out.groundKills = runUntilOver(60);

  // 2. jumping clears a ground hazard
  z.start(); clearInject(ground(260)); z.jump();
  out.jumpClears = !runUntilOver(40);

  // 3. a head-height flyer kills you standing...
  z.start(); clearInject(fly(200));
  out.flyKillsStanding = runUntilOver(60);

  // 3b. ...but ducking clears it
  z.start(); clearInject(fly(200)); z.duck(true);
  out.flyDuckClears = !runUntilOver(60); z.duck(false);

  // 4. a fish is a bonus, never fatal
  z.start(); clearInject(fish(170)); var b0=z.S.bonus;
  var fishOver = runUntilOver(30);
  out.fishBonusGain = z.S.bonus - b0; out.fishNoKill = !fishOver;

  // 5. distance climbs while playing
  z.start(); clearInject(null); var d0=z.S.dist;
  for(var i=0;i<30;i++) z.advance(1000/60);
  out.distGrew = z.S.dist > d0 + 5;

  // 6. pause freezes the world
  z.start(); for(var i=0;i<5;i++) z.advance(1000/60); z.pause(); var dP=z.S.dist;
  for(var i=0;i<20;i++) z.advance(1000/60);
  out.pauseHeld = Math.abs(z.S.dist - dP) < 1e-6; out.phaseAfterPause = z.S.phase; z.pause();

  // 7. a weak death never lowers an existing high score
  z.setHi(99999); z.start(); clearInject(ground(170)); runUntilOver(40);
  out.hiKept = z.S.hi===99999; out.hiPersisted = z.lget('cozyCatCafe.hi','0');

  // 8. a real run sets a new best
  z.setHi(0); z.start(); for(var i=0;i<28;i++) z.advance(1000/60);
  clearInject(ground(160)); runUntilOver(30);
  out.newBestSet = z.S.hi>0 && z.S.newBest===true;

  // 9. character swap wraps around the roster + persists
  var n=z.roster.length; z.setChar(n-1); z.swap(1);
  out.swapWrapped = z.ci()===0; out.charPersisted = z.lget('cozyCatCafe.char','x');
  z.swap(-1); out.swapWrapBack = z.ci()===n-1;

  // 10. ducking is NOT a dodge for ground hazards
  z.start(); z.duck(true); clearInject(ground(175));
  out.duckGroundStillKills = runUntilOver(40); z.duck(false);

  // 11. anti-tunnel: a fast obstacle in one big (clamped) frame is still caught,
  //     and the outcome is identical however the elapsed time is chunked.
  z.start(); z.S.dist=2500; clearInject(ground(205,14));      // speed pinned at the 14.5 cap
  out.bigFrameSubs = z.advance(100);                          // 100ms -> 6 sub-steps
  out.fastObstacleHit = z.S.phase==='over';
  z.start(); z.S.dist=2500; clearInject(ground(205,14));
  for(var i=0;i<6;i++) z.advance(100/6);                      // same elapsed, chunked
  out.fastObstacleHitChunked = z.S.phase==='over';

  return JSON.stringify(out);
})()`;

async function main(){
  if(!fs.existsSync(CHROME)){ console.error('Chrome not found at', CHROME, '(set CHROME_BIN)'); process.exit(2); }
  const profile = '/tmp/cozy-gameplay-profile';
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
    const evalValue = (resp)=> resp && resp.result && resp.result.result && resp.result.result.value;
    let booted=false;
    for(let i=0;i<40;i++){
      const r = await send('Runtime.evaluate',{expression:'!!(window.__cozy && window.__cozy.geom)', returnByValue:true});
      if(evalValue(r)===true){ booted=true; break; }
      await new Promise(r=>setTimeout(r,100));
    }
    if(!booted) throw new Error('__cozy.geom never appeared');

    const r = await send('Runtime.evaluate',{expression:TEST, returnByValue:true});
    if(r.result && r.result.exceptionDetails) throw new Error('test eval threw: '+JSON.stringify(r.result.exceptionDetails));
    const o = JSON.parse(evalValue(r));
    if(o.error) throw new Error('in-page: '+o.error);

    const results = [];
    const check = (name, pass, detail)=>{ results.push({name,pass,detail}); };

    check('ground hazard kills (no jump)',        o.groundKills===true,            `over=${o.groundKills}`);
    check('jump clears a ground hazard',          o.jumpClears===true,             `survived=${o.jumpClears}`);
    check('head-height flyer kills standing',     o.flyKillsStanding===true,       `over=${o.flyKillsStanding}`);
    check('ducking clears the flyer',             o.flyDuckClears===true,          `survived=${o.flyDuckClears}`);
    check('fish gives a bonus',                   o.fishBonusGain>=20,             `+${o.fishBonusGain}`);
    check('fish never kills',                     o.fishNoKill===true,             `alive=${o.fishNoKill}`);
    check('distance climbs while playing',        o.distGrew===true,               `grew=${o.distGrew}`);
    check('pause freezes the world',              o.pauseHeld===true && o.phaseAfterPause==='pause', `phase=${o.phaseAfterPause}`);
    check('weak death keeps the higher best',     o.hiKept===true && o.hiPersisted==='99999', `hi=${o.hiPersisted}`);
    check('a real run sets a new best',           o.newBestSet===true,             `newBest=${o.newBestSet}`);
    check('swap wraps the roster + persists',     o.swapWrapped===true && o.charPersisted==='0', `ci=0→${o.charPersisted}`);
    check('swap(-1) wraps back to the end',       o.swapWrapBack===true,           `back=${o.swapWrapBack}`);
    check('ducking is not a ground dodge',        o.duckGroundStillKills===true,   `over=${o.duckGroundStillKills}`);
    check('big frame splits into 6 sub-steps',    o.bigFrameSubs===6,              `subs=${o.bigFrameSubs}`);
    check('fast obstacle caught in one big frame',o.fastObstacleHit===true,        `hit=${o.fastObstacleHit}`);
    check('outcome identical when frame chunked',  o.fastObstacleHitChunked===true && o.fastObstacleHit===o.fastObstacleHitChunked, `chunked=${o.fastObstacleHitChunked}`);
    check('no console errors / exceptions',       errors.length===0,               errors.join(' | ') || 'none');

    let failed=0;
    console.log('\nCat Run — gameplay-correctness tests\n');
    for(const rr of results){
      console.log(`  ${rr.pass?'\x1b[32m✓\x1b[0m':'\x1b[31m✗\x1b[0m'} ${rr.name}  \x1b[2m(${rr.detail})\x1b[0m`);
      if(!rr.pass) failed++;
    }
    console.log(`\n${failed===0?'\x1b[32mALL PASS\x1b[0m':('\x1b[31m'+failed+' FAILED\x1b[0m')} (${results.length} checks)\n`);

    ws.close(); chrome.kill();
    process.exit(failed===0?0:1);
  } catch(e){
    console.error('TEST HARNESS ERROR:', e.message);
    try{ ws && ws.close(); }catch(_){}
    chrome.kill();
    process.exit(2);
  }
}
main();
