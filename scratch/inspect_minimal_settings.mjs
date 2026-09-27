import { connect } from './cartridges/cdp.mjs';

async function main() {
    const client = await connect('SharedJSContext');
    const info = await client.evaluate(`
        (async () => {
            const reactDOM = window.__testReactDOM;
            if (!reactDOM) return { error: 'No reactDOM' };
            const container = document.createElement('div');
            const root = reactDOM.createRoot(container);
            const nav = window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS['steam-cartridges-dev'];
            root.render(nav.content);
            await new Promise(r => setTimeout(r, 200));

            // Query sections and rows
            const sections = [];
            const secEls = container.querySelectorAll('.PanelSection, [class*="PanelSection"]');
            for (const s of secEls) {
                const titleEl = s.querySelector('[class*="PanelSectionTitle"], [class*="Title"]');
                const title = titleEl ? titleEl.textContent.trim() : 'Unknown';
                
                // Find all fields/rows in this section
                const fields = [];
                const fieldEls = s.querySelectorAll('[class*="Field"], [class*="PanelSectionRow"]');
                for (const f of fieldEls) {
                    const labelEl = f.querySelector('[class*="Label"]');
                    const label = labelEl ? labelEl.textContent.trim() : '';
                    const buttons = Array.from(f.querySelectorAll('button')).map(b => b.textContent.trim());
                    const text = f.textContent.trim();
                    if (label || buttons.length > 0) {
                        fields.push({ label, buttons, text });
                    }
                }
                sections.push({ title, fields });
            }

            return {
                ok: true,
                sections: sections.filter(s => s.title !== 'Unknown'),
            };
        })()
    `);

    console.log(JSON.stringify(info, null, 2));
    process.exit(0);
}

main().catch(console.error);
