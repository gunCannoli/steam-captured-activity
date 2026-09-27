import { connect } from './cartridges/cdp.mjs';

async function main() {
    const client = await connect('SharedJSContext');
    const result = await client.evaluate(`
        (async () => {
            const reactDOM = window.__testReactDOM;
            if (!reactDOM) return { error: 'No reactDOM' };
            const container = document.createElement('div');
            document.body.appendChild(container);
            const root = reactDOM.createRoot(container);
            const nav = window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS['steam-cartridges-dev'];
            root.render(nav.content);
            await new Promise(r => setTimeout(r, 200));

            const testResults = {};

            // 1. Initial State: Check active services & verify '+ Add Service' is hidden
            const metaButtonsInitial = Array.from(container.querySelectorAll('.PanelSection'))
                .find(s => s.textContent.includes('Metadata'))
                ?.querySelectorAll('button');
            const hasAddServiceInitial = Array.from(metaButtonsInitial || []).some(b => b.textContent.includes('+ Add Service'));
            testResults.addServiceInitiallyHiddenWhenAllAdded = !hasAddServiceInitial;

            // 2. Click 'Remove' on first metadata service
            const metaSec = Array.from(container.querySelectorAll('.PanelSection'))
                .find(s => s.textContent.includes('Metadata'));
            const removeButtons = Array.from(metaSec?.querySelectorAll('button') || []).filter(b => b.textContent === 'Remove');
            if (removeButtons.length > 0 && removeButtons[0]) {
                removeButtons[0].click(); // Click first metadata remove button (Steam Store Mirror)
                await new Promise(r => setTimeout(r, 200));
                
                // Now check if '+ Add Service' appears
                const metaButtonsAfter = Array.from(container.querySelectorAll('.PanelSection'))
                    .find(s => s.textContent.includes('Metadata'))
                    ?.querySelectorAll('button');
                const hasAddServiceAfter = Array.from(metaButtonsAfter || []).some(b => b.textContent.includes('+ Add Service'));
                testResults.addServiceAppearsAfterRemove = hasAddServiceAfter;

                // Click '+ Add Service' to verify modal opens
                const addBtn = Array.from(metaButtonsAfter || []).find(b => b.textContent.includes('+ Add Service'));
                if (addBtn) {
                    addBtn.click();
                    await new Promise(r => setTimeout(r, 200));
                    const modal = document.querySelector('[style*="position: fixed"]');
                    testResults.addServiceModalOpens = !!modal && modal.textContent.includes('Register Metadata Service');
                    
                    // Close modal
                    const closeBtn = modal?.querySelector('button');
                    closeBtn?.click();
                    await new Promise(r => setTimeout(r, 100));
                }
            }

            // 3. Click 'Review & Fix' on Library Audit
            const reviewBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Review & Fix');
            if (reviewBtn) {
                reviewBtn.click();
                await new Promise(r => setTimeout(r, 200));
                const auditModal = document.querySelector('[style*="position: fixed"]');
                testResults.auditModalOpens = !!auditModal && auditModal.textContent.includes('Library Audit');
                
                // Verify tabs inside audit modal
                testResults.auditModalHasTabs = auditModal?.textContent.includes('Unknown Input') && auditModal?.textContent.includes('No Achievements');

                // Close audit modal
                const doneBtn = Array.from(auditModal?.querySelectorAll('button') || []).find(b => b.textContent === 'Done');
                doneBtn?.click();
                await new Promise(r => setTimeout(r, 100));
            }

            // 4. Click '+ Add Rule'
            const addRuleBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === '+ Add Rule');
            if (addRuleBtn) {
                addRuleBtn.click();
                await new Promise(r => setTimeout(r, 200));
                const ruleModal = document.querySelector('[style*="position: fixed"]');
                testResults.addRuleModalOpens = !!ruleModal && ruleModal.textContent.includes('Add Routing Rule');

                // Close rule modal
                const cancelBtn = Array.from(ruleModal?.querySelectorAll('button') || []).find(b => b.textContent === 'Cancel');
                cancelBtn?.click();
                await new Promise(r => setTimeout(r, 100));
            }

            // Clean up DOM container
            document.body.removeChild(container);

            return {
                ok: true,
                testResults
            };
        })()
    `);

    console.log('Modal & Dynamic Interaction Test Results:', JSON.stringify(result, null, 2));
    process.exit(0);
}

main().catch(console.error);
