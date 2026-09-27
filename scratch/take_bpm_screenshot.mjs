import { connect } from './cartridges/cdp.mjs';

const c = await connect('Steam Big Picture Mode');
console.log('Connected to BPM');

// In Big Picture Mode, let's capture via CDP with a 5-second timeout
const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000));
try {
    await Promise.race([
        c.screenshot('scratch/bpm_retroachievements_screen.png'),
        timeoutPromise
    ]);
    console.log('Saved screenshot successfully!');
} catch (e) {
    console.warn('Screenshot error or timeout:', e.message);
} finally {
    c.close();
}
