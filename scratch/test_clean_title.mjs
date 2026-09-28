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

function cleanTitle(name) {
    if (!name || name === '') return '';
    let cleaned = name;
    cleaned = cleaned.replace(/\.\w\w\w?\w?$/, ''); // extensions
    cleaned = cleaned.replace(/\(.*?\)/g, '');      // (USA)
    cleaned = cleaned.replace(/\[.*?\]/g, '');      // [v1.0]
    if (cleaned.includes('/')) {
        const first = cleaned.match(/^(.*?)\s*\//);
        if (first && first[1].replace(/\s+/g, '').length >= 2) cleaned = first[1];
    }
    cleaned = cleaned.replace(/_/g, ' ');
    // Normalize "Mother 1 + 2" -> "Mother 1+2"
    cleaned = cleaned.replace(/\s*\+\s*/g, '+');
    // Normalize "E. V. O." -> "E.V.O."
    cleaned = cleaned.replace(/([a-zA-Z])\.\s+([a-zA-Z])\./g, '$1.$2.');
    cleaned = cleaned.replace(/([a-zA-Z])\.\s+([a-zA-Z])\b/g, '$1.$2');
    cleaned = cleaned.replace(/["']/g, '');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned;
}

async function run() {
    const env = getEnv();
    const tokenRes = await (await fetch(`https://id.twitch.tv/oauth2/token?client_id=${env.twitch_client_id}&client_secret=${env.twitch_client_secret}&grant_type=client_credentials`, {
        method: 'POST'
    })).json();
    const token = tokenRes.access_token;

    async function queryIgdb(queryStr) {
        const query = `fields id, name, slug, summary, category, first_release_date, platforms.name, parent_game.name, parent_game.summary; search "${queryStr}"; limit 30;`;
        const res = await (await fetch('https://api.igdb.com/v4/games', {
            method: 'POST',
            headers: {
                'Client-ID': env.twitch_client_id,
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            },
            body: query
        })).json();
        return Array.isArray(res) ? res : [];
    }

    const testTitles = [
        "E. V. O.: Search for Eden",
        "Mother 1 + 2",
        "Prince of Persia",
        "Patrick Star in Mario Kart Super Circuit",
        "Donkey Kong Country 3: Dixie Kong's Double Trouble!"
    ];

    for (const raw of testTitles) {
        const clean = cleanTitle(raw);
        console.log(`\n========================================\nRAW: "${raw}" -> CLEAN: "${clean}"`);
        let results = await queryIgdb(clean);
        if (results.length === 0 && clean.includes(':')) {
            const suffix = clean.match(/:\s*(.+)$/)?.[1];
            if (suffix) {
                console.log(`Trying suffix fallback: "${suffix}"`);
                results = await queryIgdb(suffix);
            }
        }
        if (results.length === 0 && /in\s+/i.test(clean)) {
            const base = clean.match(/in\s+(.+)$/i)?.[1];
            if (base) {
                console.log(`Trying base game fallback: "${base}"`);
                results = await queryIgdb(base);
            }
        }
        console.log(`Found ${results.length} results. Top 3:`);
        for (const g of results.slice(0, 3)) {
            console.log(`  [${g.id}] "${g.name}" (summaryLen: ${g.summary?.length || 0})`);
            console.log(`     Platforms: ${g.platforms?.map(p => p.name).join(', ')}`);
        }
    }
}

run().catch(console.error);
