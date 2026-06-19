// Cat Run — global leaderboard + racing ghosts (serverless, Vercel-native).
//   GET  /api/scores            -> { top, ghosts, today, total }
//   POST /api/scores {name,char,score,samples} -> { ok, rank, top, ghosts, today, total }
// "ghosts" are the top runs' downsampled vertical tracks (y every GSTEP metres),
// replayed client-side as faint runners you race against.
const { readStore, updateStore, json, readBody } = require('./_store.js');

const MAX_RUNS = 30;     // top runs kept all-time (board + ghost pool)
const GHOSTS = 4;        // tracks returned to race against
const MAX_SAMPLES = 340; // cap a ghost track (~4 km at 12 m/sample)
const DAYS_KEPT = 12;    // rolling window of per-day run counters

const todayKey = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD in UTC — "today" resets at UTC midnight

// Best-effort per-IP throttle. In-memory, so it resets on cold start and each
// serverless instance has its own — a speed bump against spam, not a hard limit.
const RL = new Map();
const RL_WINDOW = 60 * 1000;
const RL_MAX = 30;
function rateLimited(req) {
  if (RL.size > 2000) RL.clear(); // bound the map
  const fwd = (req.headers && req.headers['x-forwarded-for']) || '';
  const ip = String(fwd).split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
  const now = Date.now();
  const rec = RL.get(ip);
  if (!rec || now - rec.start > RL_WINDOW) { RL.set(ip, { start: now, n: 1 }); return false; }
  rec.n++;
  return rec.n > RL_MAX;
}

function cleanName(s) {
  // keep printable chars only (drop control chars), strip angle brackets
  s = String(s == null ? '' : s)
    .split('')
    .filter((c) => c.charCodeAt(0) >= 32 && c !== '<' && c !== '>')
    .join('')
    .trim()
    .slice(0, 14);
  return s || 'anon';
}
function cleanChar(s) {
  s = String(s == null ? '' : s).slice(0, 8);
  return s || '🐾';
}
function cleanSamples(a) {
  if (!Array.isArray(a)) return [];
  return a.slice(0, MAX_SAMPLES).map((n) => {
    n = Math.round(Number(n));
    if (!isFinite(n)) n = 0;
    return Math.max(-220, Math.min(40, n)); // y is 0 at ground, negative = airborne
  });
}

function board(data) {
  return {
    top: data.runs.slice(0, 12).map((r) => ({ name: r.name, char: r.char, score: r.score })),
    ghosts: data.runs.slice(0, GHOSTS).map((r) => ({ name: r.name, char: r.char, score: r.score, samples: r.samples || [] })),
    today: data.days[todayKey()] || 0,
    total: data.total || 0,
  };
}

async function safeBoard() {
  try { const { data } = await readStore(); return board(data); }
  catch (e) { return { top: [], ghosts: [], today: 0, total: 0 }; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  if (req.method === 'GET') {
    return json(res, 200, await safeBoard());
  }

  if (req.method === 'POST') {
    if (rateLimited(req)) return json(res, 429, { error: 'rate_limited' });
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad_json' }); }
    const name = cleanName(body.name);
    const char = cleanChar(body.char);
    const score = Math.max(0, Math.min(100000, Math.round(Number(body.score) || 0)));
    const samples = cleanSamples(body.samples);
    if (score < 1) return json(res, 200, { ok: true, rank: null, ...(await safeBoard()) });

    try {
      const out = await updateStore((data) => {
        const tk = todayKey();
        data.days[tk] = (data.days[tk] || 0) + 1;
        data.total = (data.total || 0) + 1;
        const keys = Object.keys(data.days).sort();
        while (keys.length > DAYS_KEPT) delete data.days[keys.shift()];

        const run = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name, char, score, samples, ts: new Date().toISOString(),
        };
        data.runs.push(run);
        data.runs.sort((a, b) => b.score - a.score);
        data.runs = data.runs.slice(0, MAX_RUNS);
        const idx = data.runs.findIndex((r) => r.id === run.id);
        return { rank: idx === -1 ? null : idx + 1, board: board(data) };
      }, `run ${name} ${score}m`);
      return json(res, 200, { ok: true, rank: out.rank, ...out.board });
    } catch (e) {
      console.error('catrun POST updateStore failed:', e && e.message); // surface in function logs
      return json(res, 200, { ok: false, rank: null, ...(await safeBoard()) });
    }
  }

  return json(res, 405, { error: 'method' });
};
