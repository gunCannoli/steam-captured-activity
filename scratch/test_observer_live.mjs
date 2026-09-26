import fs from 'node:fs';
import path from 'node:path';

const PORT = '8080';

async function connect(pred, label) {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const t = targets.find(pred);
    if (!t) throw new Error(`No CDP target: ${label}`);
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
    let id = 0;
    const pend = new Map();
    ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        pend.get(m.id)?.(m);
        pend.delete(m.id);
    };
    const ev = (expression) =>
        new Promise((res, rej) => {
            pend.set(++id, (m) =>
                m.result?.exceptionDetails ? rej(new Error(JSON.stringify(m.result.exceptionDetails))) : res(m.result?.result?.value),
            );
            ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
        });
    return { ev, close: () => ws.close() };
}

async function main() {
    console.log('Connecting to SharedJSContext...');
    let shared;
    for (let i = 0; i < 15; i++) {
        try {
            shared = await connect((t) => t.title === 'SharedJSContext', 'SharedJSContext');
            break;
        } catch {
            await new Promise((r) => setTimeout(r, 1000));
        }
    }
    if (!shared) throw new Error('Could not connect to SharedJSContext');

    const S = 2315502503; // Jotunnslayer shortcut
    const N = 2820820;    // Native Steam AppID

    // Prepare test directory in %PUBLIC%\Documents\Steam\CODEX\<N>
    const publicDoc = process.env.PUBLIC || 'C:\\Users\\Public';
    const codexDir = path.join(publicDoc, 'Documents', 'Steam', 'CODEX', String(N));
    const iniPath = path.join(codexDir, 'achievements.ini');

    fs.mkdirSync(codexDir, { recursive: true });

    try {
        console.log('1. Resetting and loading baseline schema for Jotunnslayer...');
        await shared.ev(`(async () => {
            const plug = window.PLUGIN_LIST?.['steam-cartridges-dev'] ?? window.PLUGIN_LIST?.['steam-cartridges'];
            await plug.resetAchievements(${S});
            await plug.loadAchievementsForApp(${S}, ${N});
        })()`);

        const before = await shared.ev(`(() => {
            const ach = window.appDetailsStore?.GetAchievements(${S});
            return {
                nTotal: ach?.nTotal,
                nAchieved: ach?.nAchieved
            };
        })()`);
        console.log('Baseline status:', JSON.stringify(before, null, 2));

        console.log('2. Writing simulated emulator unlock to CODEX achievements.ini...');
        const iniContent = `[ACH_A_TROPHY_SPECIAL]
Achieved=1
CurProgress=0
MaxProgress=0
UnlockTime=1760846000
`;
        fs.writeFileSync(iniPath, iniContent, 'utf-8');

        console.log('3. Triggering checkObserverUnlocks via plugin with toast interception...');
        const checkRes = await shared.ev(`(async () => {
            const plug = window.PLUGIN_LIST?.['steam-cartridges-dev'] ?? window.PLUGIN_LIST?.['steam-cartridges'];
            
            let toastFired = false;
            let capturedType = null;
            const store = window.NotificationStore;
            const proto = store ? Object.getPrototypeOf(store) : null;
            let orig;
            if (proto && typeof proto.PlayNotificationSound === 'function') {
                orig = proto.PlayNotificationSound;
                proto.PlayNotificationSound = function(n) {
                    toastFired = true;
                    capturedType = n ? n.eType : null;
                    return orig.call(this, n);
                };
            }

            let count = 0;
            try {
                count = await plug.checkObserverUnlocks(${S}, ${N}, "Jotunnslayer");
                await new Promise((r) => setTimeout(r, 500));
            } finally {
                if (proto && orig) {
                    proto.PlayNotificationSound = orig;
                }
            }

            const after = window.appDetailsStore?.GetAchievements(${S});
            return {
                newCount: count,
                toastFired,
                capturedType,
                nAchievedAfter: after?.nAchieved,
                topHighlight: after?.vecHighlight?.[0]?.strName
            };
        })()`);
        console.log('Observer check result:', JSON.stringify(checkRes, null, 2));

        console.log('4. Verifying persistence in achievements.json...');
        const configPath = 'C:\\game\\steam\\millennium\\config\\steam-cartridges\\achievements.json';
        if (fs.existsSync(configPath)) {
            const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            const sc = data.shortcuts?.[String(S)];
            console.log('Persisted unlocks for shortcut:', sc?.unlocks ? Object.keys(sc.unlocks) : []);
        }

        const pass = checkRes.newCount === 1 && checkRes.toastFired && checkRes.capturedType === 5 && checkRes.nAchievedAfter === 1;
        console.log(`\nOverall In-Game Observer Verification: ${pass ? 'PASS' : 'FAIL'}`);

    } finally {
        // Cleanup test directory
        try {
            if (fs.existsSync(iniPath)) fs.unlinkSync(iniPath);
            if (fs.existsSync(codexDir)) fs.rmdirSync(codexDir);
        } catch {}

        shared.close();
    }
}

main().catch(console.error);
