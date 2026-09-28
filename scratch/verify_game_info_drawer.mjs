const PORT = '8080';

async function run() {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const steamTarget = list.find(t => t.title === 'Steam');
    if (!steamTarget) {
        console.error('Steam target not found!');
        return;
    }

    const sharedTarget = list.find(t => t.title === 'SharedJSContext');
    const wsShared = new WebSocket(sharedTarget.webSocketDebuggerUrl);
    await new Promise(r => wsShared.onopen = r);

    const ws = new WebSocket(steamTarget.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);

    let id = 1;
    const send = (socket, m, p = {}) => new Promise(res => {
        const reqId = id++;
        const h = e => {
            const msg = JSON.parse(e.data);
            if (msg.id === reqId) {
                socket.removeEventListener('message', h);
                res(msg.result);
            }
        };
        socket.addEventListener('message', h);
        socket.send(JSON.stringify({ id: reqId, method: m, params: p }));
    });

    console.log('Connected to Steam window and SharedJSContext via CDP.');

    // 1. Navigate to Alundra: 3858889198
    const appid = '3858889198';
    console.log(`Navigating to appid ${appid}...`);
    await send(wsShared, 'Runtime.evaluate', {
        expression: `SteamClient.URL.ExecuteSteamURL('steam://nav/games/details/${appid}')`
    });

    // Wait 3 seconds for page render and metadata enrichment
    await new Promise(r => setTimeout(r, 3000));

    // 2. Inspect PlayBar and ⓘ button
    const playBarCheck = await send(ws, 'Runtime.evaluate', {
        expression: `(() => {
            const playbar = document.querySelector('[class*="PlayBar"]');
            const infoSvg = document.querySelector('.SVGIcon_Information');
            let infoBtn = infoSvg?.parentElement;
            while (infoBtn && !infoBtn.className.includes('MenuButton')) infoBtn = infoBtn.parentElement;

            const buttons = Array.from(document.querySelectorAll('[class*="AppButtonsContainer"] [class*="MenuButton"]'));

            return {
                hasPlayBar: Boolean(playbar),
                buttonsCount: buttons.length,
                infoBtnFound: Boolean(infoBtn),
                infoBtnClasses: infoBtn ? infoBtn.className : null,
                infoSvgFound: Boolean(infoSvg)
            };
        })()`,
        returnByValue: true
    });

    console.log('PlayBar Check Result:', JSON.stringify(playBarCheck.result?.value, null, 2));

    // 3. Inspect Game Info Drawer before click
    const drawerBefore = await send(ws, 'Runtime.evaluate', {
        expression: `(() => {
            const drawer = document.querySelector('[class*="AppGameInfoContainer"]');
            const nonsteam = document.querySelector('#AppDetails_Shortcut_Explanation, [class*="ShortcutExplanation"]');
            return {
                drawerFound: Boolean(drawer),
                drawerClass: drawer?.className,
                drawerHeight: drawer?.getBoundingClientRect()?.height,
                nonsteamWarningFound: Boolean(nonsteam),
                bodyText: drawer?.innerText?.slice(0, 200)
            };
        })()`,
        returnByValue: true
    });
    console.log('Drawer Before Click:', JSON.stringify(drawerBefore.result?.value, null, 2));

    // 4. Click the in-page ⓘ button (the one inside the in-page PlayBar, not sticky header)
    const clickResult = await send(ws, 'Runtime.evaluate', {
        expression: `(() => {
            const inPagePlayBar = document.querySelector('[class*="PlayBar"][class*="Container"]');
            const infoSvg = inPagePlayBar ? inPagePlayBar.querySelector('.SVGIcon_Information') : document.querySelector('.SVGIcon_Information');
            let infoBtn = infoSvg?.parentElement;
            while (infoBtn && !infoBtn.className.includes('MenuButton')) infoBtn = infoBtn.parentElement;

            if (!infoBtn) return { error: 'No info button to click' };
            infoBtn.click();
            return { clicked: true, className: infoBtn.className };
        })()`,
        returnByValue: true
    });
    console.log('Click Result:', JSON.stringify(clickResult.result?.value, null, 2));

    // Wait 1.5 seconds for drawer expansion animation
    await new Promise(r => setTimeout(r, 1500));

    // 5. Inspect Game Info Drawer after click
    const drawerAfter = await send(ws, 'Runtime.evaluate', {
        expression: `(() => {
            const drawer = document.querySelector('[class*="AppGameInfoContainer"]');
            const desc = document.querySelector('[class*="GameDescription"], [class*="Snippet"]');
            const specs = document.querySelector('[class*="DetailsSpecs"], [class*="FeaturesList"]');
            const nonsteam = document.querySelector('#AppDetails_Shortcut_Explanation, [class*="ShortcutExplanation"]');
            return {
                drawerFound: Boolean(drawer),
                drawerClass: drawer?.className,
                drawerHeight: drawer?.getBoundingClientRect()?.height,
                hasDescription: Boolean(desc),
                descSnippet: desc?.innerText?.slice(0, 150),
                hasSpecs: Boolean(specs),
                nonsteamWarningFound: Boolean(nonsteam),
                fullDrawerText: drawer?.innerText?.slice(0, 400)
            };
        })()`,
        returnByValue: true
    });
    console.log('Drawer After Expand:', JSON.stringify(drawerAfter.result?.value, null, 2));

    // 6. Click again to test collapse
    console.log('Clicking again to collapse...');
    const collapseResult = await send(ws, 'Runtime.evaluate', {
        expression: `(() => {
            const inPagePlayBar = document.querySelector('[class*="PlayBar"][class*="Container"]');
            const infoSvg = inPagePlayBar ? inPagePlayBar.querySelector('.SVGIcon_Information') : document.querySelector('.SVGIcon_Information');
            let infoBtn = infoSvg?.parentElement;
            while (infoBtn && !infoBtn.className.includes('MenuButton')) infoBtn = infoBtn.parentElement;

            if (!infoBtn) return { error: 'No info button to click' };
            infoBtn.click();
            return { clicked: true };
        })()`,
        returnByValue: true
    });

    await new Promise(r => setTimeout(r, 1500));

    const drawerAfterCollapse = await send(ws, 'Runtime.evaluate', {
        expression: `(() => {
            const drawer = document.querySelector('[class*="AppGameInfoContainer"]');
            return {
                drawerFound: Boolean(drawer),
                drawerClass: drawer?.className,
                drawerHeight: drawer?.getBoundingClientRect()?.height
            };
        })()`,
        returnByValue: true
    });
    console.log('Drawer After Collapse:', JSON.stringify(drawerAfterCollapse.result?.value, null, 2));

    ws.close();
}

run().catch(console.error);
