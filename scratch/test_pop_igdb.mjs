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

async function run() {
    const env = getEnv();
    const tokenRes = await (await fetch(`https://id.twitch.tv/oauth2/token?client_id=${env.twitch_client_id}&client_secret=${env.twitch_client_secret}&grant_type=client_credentials`, {
        method: 'POST'
    })).json();
    const token = tokenRes.access_token;

    const query = `fields id, name, slug, summary, category, first_release_date, platforms.name, parent_game.name, parent_game.summary; where name ~ "Prince of Persia"*; sort first_release_date asc; limit 20;`;
    const res = await (await fetch('https://api.igdb.com/v4/games', {
        method: 'POST',
        headers: {
            'Client-ID': env.twitch_client_id,
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        },
        body: query
    })).json();

    console.log('Early Prince of Persia games:');
    for (const g of res) {
        console.log(`[${g.id}] "${g.name}" (rel: ${g.first_release_date}, cat: ${g.category}, parent: ${g.parent_game?.name}) summaryLen: ${g.summary?.length || 0}`);
        console.log('   Platforms:', g.platforms?.map(p => p.name).join(', '));
    }
}

run().catch(console.error);
