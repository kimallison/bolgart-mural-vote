const REPO = 'kimallison/bolgart-mural-vote';
const BRANCH = 'main';
const FILE = 'data/visits.jsonl';

function ghHeaders(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'mural-visit-sink',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

async function getFile(token) {
  const r = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + FILE + '?ref=' + BRANCH, { headers: ghHeaders(token) });
  if (r.status === 404) return { sha: null, content: '' };
  if (!r.ok) throw new Error('read ' + r.status);
  const j = await r.json();
  return { sha: j.sha, content: Buffer.from(j.content, 'base64').toString('utf8') };
}

async function putFile(token, content, sha, msg) {
  const r = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + FILE, {
    method: 'PUT',
    headers: Object.assign(ghHeaders(token), { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ message: msg, content: Buffer.from(content).toString('base64'), sha: sha || undefined })
  });
  if (!r.ok) throw new Error('put ' + r.status);
}

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.end();
    return;
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) { send(res, 500, { ok: false, error: 'sink not configured' }); return; }

  if (req.method === 'GET') {
    try {
      const cur = await getFile(token);
      const rows = (cur.content || '').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
      const devices = new Set(rows.map(r => r.v));
      send(res, 200, { ok: true, devices: devices.size, opens: rows.length });
    } catch (e) { send(res, 500, { ok: false, error: 'read failed' }); }
    return;
  }

  if (req.method !== 'POST') { send(res, 405, { ok: false }); return; }
  try {
    const body = await new Promise((ok, bad) => {
      let d = '';
      req.on('data', (c) => { d += c; if (d.length > 4000) { bad(new Error('too large')); req.destroy(); } });
      req.on('end', () => ok(d));
      req.on('error', bad);
    });
    const j = JSON.parse(body);
    if (!j.v || typeof j.v !== 'string') { send(res, 400, { ok: false, error: 'no visitor id' }); return; }
    const row = { t: Date.now(), v: String(j.v).slice(0, 40).replace(/[^\w-]/g, ''), p: String(j.p || '').slice(0, 6).replace(/[^\w]/g, '') };
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const cur = await getFile(token);
        const next = (cur.content ? cur.content.replace(/\n+$/, '') + '\n' : '') + JSON.stringify(row) + '\n';
        await putFile(token, next, cur.sha, 'mural page visits');
        send(res, 200, { ok: true });
        return;
      } catch (e) {
        if (attempt === 4) throw e;
        await new Promise(r => setTimeout(r, 500 * attempt));
      }
    }
  } catch (e) { send(res, 500, { ok: false, error: 'save failed' }); }
};