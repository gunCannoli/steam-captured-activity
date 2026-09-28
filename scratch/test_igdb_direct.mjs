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
    const clientId = env.twitch_client_id;
    const clientSecret = env.twitch_client_secret;
    if (!clientId || !clientSecret) throw new Error('Missing Twitch creds');

    // Get token
    const tokenRes = await (await fetch(`https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`, {
        method: 'POST'
    })).json();
    const token = tokenRes.access_token;

    async function searchIgdb(title) {
        const query = `fields id, name, slug, summary, category, first_release_date, platforms.name; search "${title}"; limit 10;`;
        const res = await (await fetch('https://api.igdb.com/v4/games', {
            method: 'POST',
            headers: {
                'Client-ID': clientId,
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            },
            body: query
        })).json();
        return res.map(g => ({
            id: g.id,
            name: g.name,
            summaryLen: g.summary?.length || 0,
            summarySnippet: g.summary?.slice(0, 80),
            platforms: g.platforms?.map(p => p.name)
        }));
    }

    console.log('--- Search: "E.V.O." ---');
    console.log(await searchIgdb('E.V.O.'));

    console.log('--- Search: "Search for Eden" ---');
    console.log(await searchIgdb('Search for Eden'));

    console.log('--- Search: "Mother 1+2" ---');
    console.log(await searchIgdb('Mother 1+2'));

    console.log('--- Search: "Mother 1 + 2" ---');
    console.log(await searchIgdb('Mother 1 + 2'));

    console.log('--- Search: "Prince of Persia" ---');
    console.log(await searchIgdb('Prince of Persia'));

    console.log('--- Search: "Mario Kart Super Circuit" ---');
    console.log(await searchIgdb('Mario Kart Super Circuit'));
}

run().catch(console.error);
