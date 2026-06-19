// GitHub-backed JSON datastore for the Cat Run global leaderboard + ghosts.
// One file (catrun.json) lives in a SEPARATE repo so leaderboard writes never
// trigger a redeploy of the game. All creds come from env vars — never committed.
//   GH_TOKEN     — a token with `repo` (contents:write) on the data repo
//   GH_DATA_REPO — defaults to arcade-hub-data
const OWNER = 'SimonSaysGiveMeSmile';
const REPO = process.env.GH_DATA_REPO || 'arcade-hub-data';
const FILE = 'catrun.json';
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`;

const EMPTY = { v: 1, runs: [], days: {}, total: 0 };

const ghHeaders = () => ({
  Authorization: `Bearer ${process.env.GH_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'cat-run',
});

async function readStore() {
  const r = await fetch(API + '?ref=main', { headers: ghHeaders() });
  if (r.status === 404) return { data: { ...EMPTY }, sha: null }; // first write creates it
  if (!r.ok) throw new Error('store read ' + r.status);
  const j = await r.json();
  const data = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
  data.runs ||= [];
  data.days ||= {};
  data.total ||= 0;
  data.v ||= 1;
  return { data, sha: j.sha };
}

async function writeStore(data, sha, message) {
  const body = { message, content: Buffer.from(JSON.stringify(data)).toString('base64') };
  if (sha) body.sha = sha; // omit on create
  const r = await fetch(API, {
    method: 'PUT',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // 409 = stale sha, 422 = create raced with another create — both mean "re-read & retry"
  if (r.status === 409 || r.status === 422) { const e = new Error('conflict'); e.conflict = true; throw e; }
  if (!r.ok) throw new Error('store write ' + r.status + ' ' + (await r.text()).slice(0, 160));
  return r.json();
}

// Read-modify-write with optimistic-concurrency retry.
async function updateStore(mutate, message, tries = 6) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const { data, sha } = await readStore();
    const result = mutate(data);
    try { await writeStore(data, sha, message); return result; }
    catch (e) {
      lastErr = e;
      if (e.conflict && i < tries - 1) { await new Promise((r) => setTimeout(r, 130 * (i + 1))); continue; }
      throw e;
    }
  }
  throw lastErr;
}

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const MAX = 100 * 1024; // 100 KB — ~50x the largest legitimate run payload
  const len = parseInt(req.headers && req.headers['content-length'], 10);
  if (len > MAX) throw new Error('body_too_large');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX) throw new Error('body_too_large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

module.exports = { readStore, updateStore, json, readBody };
