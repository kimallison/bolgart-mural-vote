const REPO = 'kimallison/bolgart-mural-vote';
const BRANCH = 'main';
const FILE = 'data/votes.jsonl';
const SECTION = {"Carnaby's Black Cockatoo": "Old Plains Woodland", "Chuditch": "Old Plains Woodland", "Wandoo": "Old Plains Woodland", "Marri": "Old Plains Woodland", "Splendid Fairy-wren": "Old Plains Woodland", "Red-capped Robin": "Old Plains Woodland", "Grass Tree": "Old Plains Woodland", "Southern Brown Bandicoot": "Old Plains Woodland", "Common Brush-tailed Possum": "Old Plains Woodland", "Hills Salmon Gum": "Place of Water", "Spider Orchid": "Place of Water", "Eremophila": "Place of Water", "Phascogale": "Place of Water", "Wedge-tailed Eagle": "Wheat and Community", "Wheat": "Wheat and Community", "Canola": "Wheat and Community", "Merino Sheep": "Wheat and Community", "Paddock Windmill": "Wheat and Community", "Everlastings": "Wheat and Community", "Bearded Dragon": "Wheat and Community", "Christmas Tree": "Wildflower Country", "Cat Paws": "Wildflower Country", "Blue-eyed Smokebush": "Wildflower Country", "York Gum": "Wildflower Country", "Short-beaked Echidna": "Wildflower Country", "Drummond's Mallee": "Wildflower Country"};
const ORDER = ['Old Plains Woodland', 'Place of Water', 'Wheat and Community', 'Wildflower Country'];

function ghHeaders(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'mural-vote-tally',
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
  res.end(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') { send(res, 405, { ok: false }); return; }
  const token = process.env.GITHUB_TOKEN;
  if (!token) { send(res, 500, { ok: false, error: 'sink not configured' }); return; }
  try {
    const rows = await getRows(token);
    const sections = {};
    ORDER.forEach(s => { sections[s] = {}; });
    const counters = {};
    for (const name of Object.keys(SECTION)) { counters[name] = { kept: 0, out: 0 }; sections[SECTION[name]][name] = counters[name]; }
    const wants = []; const drops = [];
    for (const row of rows) {
      (row.kept || []).forEach(n => { if (counters[n]) counters[n].kept++; });
      (row.out || []).forEach(n => { if (counters[n]) counters[n].out++; });
      if (row.want) wants.push(row.want);
      if (row.drop) drops.push(row.drop);
    }
    send(res, 200, {
      ok: true, total: rows.length,
      sections: ORDER.map(s => ({ name: s, tiles: Object.keys(sections[s]).map(n => ({ name: n, kept: counters[n].kept, out: counters[n].out })) })),
      want: wants, drop: drops
    });
  } catch (e) {
    send(res, 500, { ok: false, error: 'tally failed' });
  }
};
