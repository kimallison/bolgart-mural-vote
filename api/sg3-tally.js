const REPO = 'kimallison/bolgart-mural-vote';
const BRANCH = 'main';
const FILE = 'data/round3.jsonl';
const SORDER = ["OLD_SCHOOL", "GENERAL_STORE", "CBH_SILOS", "WHEAT_BAGS_HANDLOADED", "GRAIN_TRUCKS"];

function ghHeaders(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'mural-round3-tally',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

async function getRows(token) {
  const r = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + FILE + '?ref=' + BRANCH, { headers: ghHeaders(token) });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error('read ' + r.status);
  const j = await r.json();
  const text = Buffer.from(j.content, 'base64').toString('utf8');
  return text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
}

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.end(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') { send(res, 405, { ok: false }); return; }
  const token = process.env.GITHUB_TOKEN;
  if (!token) { send(res, 500, { ok: false, error: 'sink not configured' }); return; }
  try {
    const rows = await getRows(token);
    const counters = { yes: {}, no: {} };
    SORDER.forEach(s => { counters.yes[s] = 0; counters.no[s] = 0; });
    const answers = [];
    for (const r of rows) {
      for (const s of r.yes || []) { if (s in counters.yes) counters.yes[s]++; }
      for (const s of r.no || []) { if (s in counters.no) counters.no[s]++; }
      if (r.idea) answers.push({ idea: String(r.idea) });
    }
    send(res, 200, { ok: true, total: rows.length, order: SORDER, counts: counters, answers });
  } catch (e) {
    send(res, 500, { ok: false, error: 'read failed' });
  }
};
