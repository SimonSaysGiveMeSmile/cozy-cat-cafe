#!/usr/bin/env node
/*
 * Tests for Cat Run's customization + online-leaderboard CLIENT code.
 * Loads the REAL index.html in headless Chrome (DevTools Protocol) and drives the
 * exposed window.__cozy. Runs over file:// so apiURL() is null and the network is
 * never touched — we exercise the pure client logic + ghost rendering safety:
 *
 *   1. addCustom() adds an any-emoji runner, selects it, persists it.
 *   2. The 24-custom cap holds even after many adds.
 *   3. Multi-codepoint emoji (ZWJ family) survives intact (grapheme-safe).
 *   4. applyBoard() populates NET (top / today / ghosts, passed=false).
 *   5. Ghost replay never crashes on tiny/partial/empty tracks (incl. the "passed" path).
 *   6. Offline: submitRun() is a no-op (NET.sent stays false on file://).
 *   7. boardModel() builds the podium: medals for top 3, name-match "you" flag,
 *      and an appended own-row when the player finishes off the shown list.
 *   8. drawStart() + drawOver() render the medal boards without throwing.
 *   9. No console errors / exceptions across the whole session (incl. rAF draws).
 */
const { spawn } = require('child_process');
const fs = require('fs');

const CHROME = process.env.CHROME_BIN ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const GAME_URL = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const PORT = 9335;

const FAMILY = '👨‍👩‍👧‍👦'; // 👨‍👩‍👧‍👦 (ZWJ, 1 grapheme)

const TEST = `(function(){
  var z=window.__cozy; if(!z) return JSON.stringify({error:'__cozy missing'});
  var out={};

  // 1. addCustom adds + selects + persists
  var base=z.roster.length;
  var ok=z.addCustom('🔥');
  out.addReturns=ok===true;
  out.rosterGrew=(z.roster.length===base+1);
  out.ciIsNew=(z.ci()===z.roster.length-1);
  out.curIsFire=(z.roster[z.ci()].e==='🔥');
  out.persisted=(JSON.parse(z.lget('cozyCatCafe.customs','[]')).slice(-1)[0]==='🔥');

  // 2. cap at 24 after many adds (distinct emoji so each is a real new entry)
  for(var i=0;i<30;i++){ z.addCustom(String.fromCodePoint(0x1F600+i)); }
  var stored=JSON.parse(z.lget('cozyCatCafe.customs','[]'));
  out.capHeld=(stored.length<=24);
  out.lastSelected=(z.roster[z.ci()].e===String.fromCodePoint(0x1F600+29));

  // 3. grapheme-safe ZWJ family
  z.addCustom(${JSON.stringify(FAMILY)});
  out.familyIntact=(z.roster[z.ci()].e===${JSON.stringify(FAMILY)});

  // 4. applyBoard populates NET (phase is 'start' so ghosts are accepted)
  z.applyBoard({top:[{name:'tester',char:'🐱',score:100},{name:'two',char:'🦊',score:50}],
    ghosts:[{name:'g1',char:'🐱',score:100,samples:[0,-30,-60,-20]},
            {name:'g2',char:'🦊',score:50,samples:[0]},
            {name:'g3',char:'🦖',score:40,samples:[]}],
    today:3,total:5});
  out.topOK=(z.NET.top.length===2 && z.NET.top[0].name==='tester');
  out.todayOK=(z.NET.today===3 && z.NET.total===5);
  out.ghostsOK=(z.NET.ghosts.length===3 && z.NET.ghosts[0].passed===false);

  // 5. start + advance well past the longest ghost (4 samples -> ends ~48m) so the
  //    rAF draw exercises render, lerp-bound, partial/empty tracks, and "passed".
  z.start();
  for(var f=0;f<140;f++){ if(z.S.phase!=='play') break; z.advance(1000/60); }
  out.advancedDist=Math.floor(z.S.dist);
  out.stillHasGhosts=(z.NET.ghosts.length===3);

  // 6. offline submitRun is a no-op
  z.NET.sent=false;
  z.submitRun();
  out.offlineNoSubmit=(z.NET.sent===false);

  // 7. boardModel — podium medals, name-match "you" flag, own row for off-list finishers
  var bmA=z.boardModel([{name:'aaa',char:'🐱',score:90},{name:'bbb',char:'🦊',score:80},{name:'ccc',char:'🦖',score:70},{name:'ddd',char:'🐸',score:60}], 3, 'zzz');
  out.bmLen=(bmA.length===3);
  out.bmMedals=(bmA[0].medal===true && bmA[1].medal===true && bmA[2].medal===true);
  out.bmRanks=(bmA[0].rank===1 && bmA[2].rank===3);
  out.bmNoYou=bmA.every(function(r){return !r.you;});
  var bmB=z.boardModel([{name:'aaa',char:'🐱',score:90},{name:'bbb',char:'🦊',score:80},{name:'ccc',char:'🦖',score:70}], 3, 'me', 7, 55, '💀');
  out.bmOwnRow=(bmB.length===4 && bmB[3].rank===7 && bmB[3].you===true && bmB[3].sep===true && bmB[3].char==='💀' && bmB[3].medal===false);
  var bmC=z.boardModel([{name:'ME',char:'🐱',score:90},{name:'bbb',char:'🦊',score:80}], 3, 'me', 1, 90, '🐱');
  out.bmYouMatch=(bmC[0].you===true && bmC.length===2);

  // 8. render every board branch (medal disc, plain rank, you-pill, separator) directly —
  //    apiURL()-independent, so it works over file:// where drawOver's board is gated off.
  z.applyBoard({top:[{name:'tester',char:'🐱',score:100},{name:'two',char:'🦊',score:50},{name:'me',char:'🦖',score:30}],ghosts:[],today:2,total:9});
  z.S.phase='start'; z.draw(); // start-screen podium (drawStart isn't apiURL-gated)
  var g=z.geom(); var model=z.boardModel(
    [{name:'a',char:'🐱',score:90},{name:'b',char:'🦊',score:80},{name:'c',char:'🦖',score:70}],
    3, 'a', 7, 55, '💀'); // row0 = medal + you-pill; rows1-2 = medals; row3 = plain rank + you-pill + sep
  out.modelBranches=(model.length===4 && model[0].you===true && model[0].medal===true &&
                     model[3].sep===true && model[3].medal===false);
  z.drawBoardRows(model, g.W/2, 200, 13);
  z.S.finalScore=30; z.S.finalChar='💀'; z.NET.rank=7; z.NET.done=true; z.S.phase='over'; z.draw();
  out.rendered=true;

  return JSON.stringify(out);
})()`;

async function main(){
  if(!fs.existsSync(CHROME)){ console.error('Chrome not found at', CHROME, '(set CHROME_BIN)'); process.exit(2); }
  const profile = '/tmp/cozy-online-profile';
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
      const r = await send('Runtime.evaluate',{expression:'!!(window.__cozy && window.__cozy.addCustom && window.__cozy.applyBoard && window.__cozy.boardModel && window.__cozy.draw && window.__cozy.drawBoardRows)', returnByValue:true});
      if(evalValue(r)===true){ booted=true; break; }
      await new Promise(r=>setTimeout(r,100));
    }
    if(!booted) throw new Error('__cozy online helpers never appeared');

    const r = await send('Runtime.evaluate',{expression:TEST, returnByValue:true});
    if(r.result && r.result.exceptionDetails) throw new Error('test eval threw: '+r.result.exceptionDetails.text);
    const o = JSON.parse(evalValue(r));
    if(o.error) throw new Error('in-page: '+o.error);

    // let the rAF loop draw several frames WITH ghosts present (renders + "passed" path)
    await new Promise(r=>setTimeout(r,400));

    const results = [];
    const check = (name, pass, detail)=>{ results.push({name,pass,detail}); };

    check('addCustom adds + selects a runner', o.addReturns && o.rosterGrew && o.ciIsNew && o.curIsFire, `grew=${o.rosterGrew} sel=${o.curIsFire}`);
    check('custom runner persists to storage', o.persisted, `persisted=${o.persisted}`);
    check('24-custom cap holds after 30 adds', o.capHeld, `capHeld=${o.capHeld}`);
    check('last added custom is selected', o.lastSelected, `sel=${o.lastSelected}`);
    check('ZWJ family emoji survives intact', o.familyIntact, `intact=${o.familyIntact}`);
    check('applyBoard populates top', o.topOK, `topOK=${o.topOK}`);
    check('applyBoard populates today/total', o.todayOK, `todayOK=${o.todayOK}`);
    check('applyBoard maps ghosts (passed=false)', o.ghostsOK, `ghostsOK=${o.ghostsOK}`);
    check('ghost replay survives tiny/partial tracks', o.stillHasGhosts && o.advancedDist>40, `dist=${o.advancedDist}`);
    check('offline submitRun is a no-op', o.offlineNoSubmit, `sent=${!o.offlineNoSubmit}`);
    check('boardModel returns a 3-row podium', o.bmLen, `len3=${o.bmLen}`);
    check('boardModel medals + ranks top 3', o.bmMedals && o.bmRanks, `medals=${o.bmMedals} ranks=${o.bmRanks}`);
    check('boardModel flags matching name as you', o.bmYouMatch, `match=${o.bmYouMatch}`);
    check('boardModel appends own row off-podium', o.bmOwnRow, `own=${o.bmOwnRow}`);
    check('boardModel: no false you-flag', o.bmNoYou, `noYou=${o.bmNoYou}`);
    check('board model covers every render branch', o.modelBranches, `branches=${o.modelBranches}`);
    check('boards render (medals/you-pill/sep/plain)', o.rendered===true, `rendered=${o.rendered}`);
    check('no console errors / exceptions', errors.length===0, errors.join(' | ') || 'none');

    let failed=0;
    console.log('\nCat Run — customization + leaderboard tests\n');
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
