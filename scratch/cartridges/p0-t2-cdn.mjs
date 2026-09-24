import { connect } from './cdp.mjs';
const c = await connect();
const r = await c.evaluate(`(async () => {
  const out = {};
  const files=['library_hero.jpg','library_600x900.jpg','logo.png','header.jpg'];
  out.cdn=[];
  for (const app of [435150]) for (const f of files) {
    try { const res = await fetch('https://cdn.akamai.steamstatic.com/steam/apps/'+app+'/'+f); const b = await res.arrayBuffer(); out.cdn.push([app,f,res.status,b.byteLength]); } catch(e){ out.cdn.push([app,f,'ERR',String(e).slice(0,80)]); }
  }
  try { const s = await (await fetch('https://store.steampowered.com/api/storesearch/?term=Jotunnslayer&cc=us&l=en')).json(); out.search = s.items?.slice(0,3).map(i=>[i.id,i.name]); } catch(e){ out.search='ERR '+String(e).slice(0,80); }
  const ov = window.appStore.GetAppOverviewByAppID(435150);
  out.ovAssets = Object.keys(ov).filter(k=>/filename|hash|asset/i.test(k));
  out.setCustom = Object.keys(SteamClient.Apps).filter(k=>/Custom|Artwork|Achiev/i.test(k));
  out.sicKeys = window.StoreItemCache ? Object.getOwnPropertyNames(Object.getPrototypeOf(window.StoreItemCache)).slice(0,40) : 'none';
  out.appDetailsProto = Object.getOwnPropertyNames(Object.getPrototypeOf(window.appDetailsStore)).filter(k=>/Achiev|Request/i.test(k));
  return out;
})()`);
console.log(JSON.stringify(r));
c.close();
