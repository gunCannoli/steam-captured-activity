import { connect } from "../../enhanced-notifications/tests/cdp.mjs";
const s = await connect();
const pat = process.argv[2];
console.log(await s.evaluate(`(() => { const out = []; const re = new RegExp(${JSON.stringify(pat)}, 'g');
  for (const chunk of window.webpackChunksteamui) for (const [id, fn] of Object.entries(chunk[1])) { const src = fn.toString(); let m;
    while ((m = re.exec(src)) && out.length < 12) out.push(id + ' @' + m.index + ': ' + src.slice(Math.max(0, m.index - 250), m.index + 250)); }
  return out.join(' ||| '); })()`));
s.close();
