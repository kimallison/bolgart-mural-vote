const REPO = 'kimallison/bolgart-mural-vote';
const BRANCH = 'main';
const FILE = 'data/votes.jsonl';
const VALID = ["Carnaby's Black Cockatoo", "Chuditch", "Wandoo", "Marri", "Splendid Fairy-wren", "Red-capped Robin", "Grass Tree", "Southern Brown Bandicoot", "Common Brush-tailed Possum", "Hills Salmon Gum", "Spider Orchid", "Eremophila", "Phascogale", "Wedge-tailed Eagle", "Wheat", "Canola", "Merino Sheep", "Paddock Windmill", "Everlastings", "Bearded Dragon", "Christmas Tree", "Cat Paws", "Blue-eyed Smokebush", "York Gum", "Short-beaked Echidna", "Drummond's Mallee"];
const SECTION = {"Carnaby's Black Cockatoo": "Old Plains Woodland", "Chuditch": "Old Plains Woodland", "Wandoo": "Old Plains Woodland", "Marri": "Old Plains Woodland", "Splendid Fairy-wren": "Old Plains Woodland", "Red-capped Robin": "Old Plains Woodland", "Grass Tree": "Old Plains Woodland", "Southern Brown Bandicoot": "Old Plains Woodland", "Common Brush-tailed Possum": "Old Plains Woodland", "Hills Salmon Gum": "Place of Water", "Spider Orchid": "Place of Water", "Eremophila": "Place of Water", "Phascogale": "Place of Water", "Wedge-tailed Eagle": "Wheat and Community", "Wheat": "Wheat and Community", "Canola": "Wheat and Community", "Merino Sheep": "Wheat and Community", "Paddock Windmill": "Wheat and Community", "Everlastings": "Wheat and Community", "Bearded Dragon": "Wheat and Community", "Christmas Tree": "Wildflower Country", "Cat Paws": "Wildflower Country", "Blue-eyed Smokebush": "Wildflower Country", "York Gum": "Wildflower Country", "Short-beaked Echidna": "Wildflower Country", "Drummond's Mallee": "Wildflower Country"};

function ghHeaders(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'mural-vote-sink',
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
    body: JSON.stringify({ message: msg, branch: BRANCH, sha: sha, content: Buffer.from(content, 'utf8').toString('base64') })
  });
  if (!r.ok) throw new Error('write ' + r.status);
}

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.end(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.end();
    return;
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) { send(res, 500, { ok: false, error: 'sink not configured' }); return; }

  if (req.method === 'GET') {
    try {
      const cur = await getFile(token);
      const n = cur.content ? cur.content.split('\n').filter(Boolean).length : 0;
      send(res, 200, { ok: true, total: n });
    } catch (e) { send(res, 500, { ok: false, error: 'read failed' }); }
    return;
  }

  if (req.method !== 'POST') { send(res, 405, { ok: false, error: 'method' }); return; }

  try {
    const body = await new Promise((ok, bad) => {
      let d = '';
      req.on('data', (c) => { d += c; if (d.length > 12000) { bad(new Error('too large')); req.destroy(); } });
      req.on('end', () => ok(d));
      req.on('error', bad);
    });
    const j = JSON.parse(body);
    const kept = (Array.isArray(j.kept) ? j.kept : []).map(s => String(s).trim()).filter(s => VALID.includes(s));
    const out = (Array.isArray(j.out) ? j.out : []).map(s => String(s).trim()).filter(s => VALID.includes(s));
    const name = String(j.name || '').slice(0, 60).replace(/[\r\n]/g, ' ').trim();
    const want = String(j.want || '').slice(0, 400).replace(/[\r\n]+/g, ' ').trim();
    const drop = String(j.drop || '').slice(0, 250).replace(/[\r\n]+/g, ' ').trim();
    if (!kept.length && !out.length && !want && !drop) { send(res, 400, { ok: false, error: 'empty vote' }); return; }
    const row = { t: Date.now(), kept, out, name, want, drop };
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const cur = await getFile(token);
        const next = (cur.content ? cur.content.replace(/\n+$/, '') + '\n' : '') + JSON.stringify(row) + '\n';
        await putFile(token, next, cur.sha, 'mural vote');
        send(res, 200, { ok: true, total: next.split('\n').filter(Boolean).length });
        return;
      } catch (e) {
        if (attempt === 4) throw e;
        await new Promise(r => setTimeout(r, 600 * attempt));
      }
    }
  } catch (e) {
    send(res, 500, { ok: false, error: 'save failed' });
  }
};
