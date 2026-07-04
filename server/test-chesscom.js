const https = require('https');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first'); // force IPv4

const username = 'balendra_singh';

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'ChessLens/1.0 (contact@chesslens.app)' },
      family: 4,
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

(async () => {
  console.log('\n1. Testing player profile...');
  try {
    const r = await get(`https://api.chess.com/pub/player/${username}`);
    const json = JSON.parse(r.body);
    console.log(`   ✅ ${r.status} — username: ${json.username}`);
  } catch (e) { console.log(`   ❌ ${e.message}`); }

  console.log('\n2. Testing archives list...');
  try {
    const r = await get(`https://api.chess.com/pub/player/${username}/games/archives`);
    const json = JSON.parse(r.body);
    const archives = json.archives || [];
    console.log(`   ✅ ${r.status} — found ${archives.length} archive months`);
    if (archives.length) {
      console.log(`   Most recent: ${archives[archives.length - 1]}`);
      console.log(`   Oldest:      ${archives[0]}`);
    }

    if (archives.length) {
      const latest = archives[archives.length - 1];
      console.log(`\n3. Testing latest archive: ${latest}`);
      try {
        const r2 = await get(latest);
        const json2 = JSON.parse(r2.body);
        console.log(`   ✅ ${r2.status} — ${(json2.games || []).length} games`);
      } catch (e) { console.log(`   ❌ ${e.message}`); }
    }
  } catch (e) { console.log(`   ❌ ${e.message}`); }
})();
