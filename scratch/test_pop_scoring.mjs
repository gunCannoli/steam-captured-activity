import fs from 'fs';

function getEnv() {
    const content = fs.readFileSync('C:/game/millennium/.env', 'utf8');
    const map = {};
    for (const line of content.split(/\r?\n/)) {
        const m = line.match(/^\s*([\w_]+)\s*=\s*(.*?)\s*$/);
        if (m) map[m[1].toLowerCase()] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    return map;
}

function scoreCandidate(cand, cleanLower, hints) {
    let score = 0;
    const candName = (cand.name || '').toLowerCase();
    if (candName === cleanLower) {
        score += 200; // exact match
    } else if (candName.includes(cleanLower)) {
        score += 50;
    }

    // Penalize compilations if search didn't ask for them
    if (!cleanLower.includes('pack') && !cleanLower.includes('collection') && !cleanLower.includes('bundle')) {
        if (candName.includes('action pack') || candName.includes('collection') || candName.includes('bundle')) {
            score -= 100;
        }
    }

    // Platforms
    const platStr = (cand.platforms || []).map(p => p.name.toLowerCase()).join(' ');
    for (const h of hints) {
        if (h === 'snes' && (platStr.includes('super nintendo') || platStr.includes('snes') || platStr.includes('super famicom'))) {
            score += 150;
        }
    }

    const summary = cand.summary || '';
    if (summary.length > 150) {
        score += 30;
    } else if (summary.length > 0 && summary.length < 80) {
        score -= 40;
    } else if (summary.length === 0) {
        score -= 150; // zero summary penalty
    }

    return score;
}

async function run() {
    const env = getEnv();
    const tokenRes = await (await fetch(`https://id.twitch.tv/oauth2/token?client_id=${env.twitch_client_id}&client_secret=${env.twitch_client_secret}&grant_type=client_credentials`, {
        method: 'POST'
    })).json();
    const token = tokenRes.access_token;

    const query = `fields id, name, slug, summary, category, first_release_date, platforms.name, parent_game.name, parent_game.summary; search "Prince of Persia"; limit 30;`;
    const res = await (await fetch('https://api.igdb.com/v4/games', {
        method: 'POST',
        headers: {
            'Client-ID': env.twitch_client_id,
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        },
        body: query
    })).json();

    const scored = res.map(g => ({
        id: g.id,
        name: g.name,
        score: scoreCandidate(g, 'prince of persia', ['snes']),
        summaryLen: g.summary?.length || 0,
        platforms: g.platforms?.map(p => p.name)
    })).sort((a, b) => b.score - a.score);

    console.log('Top scored candidates for Prince of Persia with snes hint:');
    for (const s of scored.slice(0, 5)) {
        console.log(`[${s.id}] "${s.name}" -> Score: ${s.score}, summaryLen: ${s.summaryLen}, platforms: ${s.platforms?.join(', ')}`);
    }
}

run().catch(console.error);
