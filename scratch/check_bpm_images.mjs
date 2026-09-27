import { connect } from './cartridges/cdp.mjs';

const c = await connect('Steam Big Picture Mode');
const data = await c.evaluate(`
    (() => {
        const imgs = Array.from(document.querySelectorAll('img'))
            .filter(img => img.src && img.src.includes('retroachievements'))
            .map(img => ({
                src: img.src,
                alt: img.alt,
                text: img.closest('[class*="Achievement"], [class*="achievement"], div')?.innerText?.trim()?.replace(/\\s+/g, ' ')
            }));
        return {
            title: document.title,
            header: document.querySelector('h1, h2, [class*="Title"]')?.innerText,
            count: imgs.length,
            sample: imgs.slice(0, 5)
        };
    })()
`);
console.log(JSON.stringify(data, null, 2));
c.close();
