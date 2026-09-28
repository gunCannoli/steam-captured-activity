const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const steam = list.find(t => t.title === 'Steam');
    const ws = new WebSocket(steam.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);

    let id = 1;
    const send = (m, p = {}) => new Promise(res => {
        const reqId = id++;
        const h = e => {
            const msg = JSON.parse(e.data);
            if (msg.id === reqId) {
                ws.removeEventListener('message', h);
                res(msg.result?.result?.value ?? msg);
            }
        };
        ws.addEventListener('message', h);
        ws.send(JSON.stringify({ id: reqId, method: m, params: p }));
    });

    console.log('--- Step 1: Initial State ---');
    const state1 = await send('Runtime.evaluate', {
        expression: `(() => {
            const drawer = document.querySelector('[class*="AppGameInfoContainer"]');
            return {
                height: drawer?.getBoundingClientRect()?.height,
                className: drawer?.className
            };
        })()`,
        returnByValue: true
    });
    console.log('Current State:', state1);

    console.log('--- Step 2: Clicking In-Page Info Button to Expand ---');
    const clickExpand = await send('Runtime.evaluate', {
        expression: `(() => {
            // Find all playbars and locate the in-page one (not sticky header)
            const playbars = Array.from(document.querySelectorAll('[class*="PlayBar"]'));
            for (const pb of playbars) {
                const key = Object.keys(pb).find(k => k.startsWith('__reactFiber'));
                let fiber = key ? pb[key] : null;
                while (fiber && !fiber.type?.s_setGameInfoVisible) fiber = fiber.return;
                if (fiber && fiber.memoizedProps?.bShowInfoExpanded !== undefined) {
                    const infoSvg = pb.querySelector('.SVGIcon_Information');
                    let btn = infoSvg?.parentElement;
                    while (btn && !btn.className.includes('MenuButton')) btn = btn.parentElement;
                    if (btn) {
                        btn.click();
                        return { clicked: true, bShowInfoExpanded: fiber.memoizedProps.bShowInfoExpanded };
                    }
                }
            }
            return { error: 'Not found' };
        })()`,
        returnByValue: true
    });
    console.log('Click Expand Result:', clickExpand);

    await new Promise(r => setTimeout(r, 1200));

    const state2 = await send('Runtime.evaluate', {
        expression: `(() => {
            const drawer = document.querySelector('[class*="AppGameInfoContainer"]');
            const desc = document.querySelector('[class*="GameDescription"], [class*="Snippet"]');
            const specs = document.querySelector('[class*="DetailsSpecs"], [class*="FeaturesList"]');
            const nonsteam = document.querySelector('#AppDetails_Shortcut_Explanation, [class*="ShortcutExplanation"]');
            return {
                height: drawer?.getBoundingClientRect()?.height,
                className: drawer?.className,
                hasDescription: Boolean(desc),
                hasSpecs: Boolean(specs),
                hasNonsteamWarning: Boolean(nonsteam)
            };
        })()`,
        returnByValue: true
    });
    console.log('State After Expand:', state2);

    console.log('--- Step 3: Clicking In-Page Info Button to Collapse ---');
    const clickCollapse = await send('Runtime.evaluate', {
        expression: `(() => {
            const playbars = Array.from(document.querySelectorAll('[class*="PlayBar"]'));
            for (const pb of playbars) {
                const key = Object.keys(pb).find(k => k.startsWith('__reactFiber'));
                let fiber = key ? pb[key] : null;
                while (fiber && !fiber.type?.s_setGameInfoVisible) fiber = fiber.return;
                if (fiber && fiber.memoizedProps?.bShowInfoExpanded !== undefined) {
                    const infoSvg = pb.querySelector('.SVGIcon_Information');
                    let btn = infoSvg?.parentElement;
                    while (btn && !btn.className.includes('MenuButton')) btn = btn.parentElement;
                    if (btn) {
                        btn.click();
                        return { clicked: true, bShowInfoExpanded: fiber.memoizedProps.bShowInfoExpanded };
                    }
                }
            }
            return { error: 'Not found' };
        })()`,
        returnByValue: true
    });
    console.log('Click Collapse Result:', clickCollapse);

    await new Promise(r => setTimeout(r, 1200));

    const state3 = await send('Runtime.evaluate', {
        expression: `(() => {
            const drawer = document.querySelector('[class*="AppGameInfoContainer"]');
            return {
                height: drawer?.getBoundingClientRect()?.height,
                className: drawer?.className
            };
        })()`,
        returnByValue: true
    });
    console.log('State After Collapse:', state3);

    ws.close();
}

run().catch(console.error);
