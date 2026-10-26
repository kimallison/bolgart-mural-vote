const REPO = 'kimallison/bolgart-mural-vote';
const BRANCH = 'main';
const FILE = 'data/suggestions.jsonl';
const SVALID = ["TRACTOR_CROP", "HARVEST_IN_PROGRESS", "SHEEPDOG_WORKING_SHEEP", "GRAIN_TRUCKS", "XF_UTE", "BEDFORD_TRUCK", "SAWMILL_HILL_CAR", "SILOS", "OLD_FARMER", "EMU_WALLABY", "DONKEY_ORCHID_GILGIE", "HILLTOP_GROVE", "BELL_TOWER", "FOOTY_CLUB", "WHEAT_REDO", "TOWN_FARM_SCENE", "COMBINE_FARMING_NATURE"];

function ghHeaders(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'mural-suggestions-sink',
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
  const j = await r.json();
  return j;
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
    const yes = (Array.isArray(j.yes) ? j.yes : []).map(s => String(s).trim()).filter(s => SVALID.includes(s));
    const no = (Array.isArray(j.no) ? j.no : []).map(s => String(s).trim()).filter(s => SVALID.includes(s));
    const name = String(j.name || '').slice(0, 60).replace(/[\r\n]/g, ' ').trim();
    const idea = String(j.idea || '').slice(0, 400).replace(/[\r\n]+/g, ' ').trim();
    if (!yes.length && !no.length && !idea) { send(res, 400, { ok: false, error: 'empty answer' }); return; }
    const row = { t: Date.now(), yes, no, name, idea: idea };
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const cur = await getFile(token);
        const next = (cur.content ? cur.content.replace(/\n+$/, '') + '\n' : '') + JSON.stringify(row) + '\n';
        await putFile(token, next, cur.sha, 'mural suggestions round two');
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