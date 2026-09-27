// scratch/test_multi_emu_rpc.mjs
async function connect(title) {
  const targets = await (await fetch('http://127.0.0.1:8080/json')).json();
  const target = targets.find(t => t.title === title);
  if (!target) throw new Error(`Target ${title} not found`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };

  const evaluate = (expression) => new Promise((resolve, reject) => {
    const curId = ++id;
    pending.set(curId, (m) => {
      if (m.error) reject(m.error);
      else resolve(m.result.result?.value);
    });
    ws.send(JSON.stringify({
      id: curId,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true }
    }));
  });

  return { ws, evaluate };
}

async function main() {
  const { ws, evaluate } = await connect('SharedJSContext');

  console.log('Testing Castlevania SotN (2162501062)...');
  const raw1 = await evaluate(`
    Millennium.callServerMethod('steam-cartridges-dev', 'CartridgesAchievementsGet', {
      payload: JSON.stringify({ shortcut_appid: 2162501062 })
    })
  `);
  const res1 = typeof raw1 === 'string' ? JSON.parse(raw1) : raw1;
  console.log('SotN GameID:', res1?.schema?.ra_game_id);
  console.log('SotN Title:', res1?.schema?.title);
  console.log('SotN Total:', res1?.schema?.total);
  console.log('SotN Achievements in array:', res1?.schema?.achievements?.length);
  console.log('SotN Unlocks count:', Object.keys(res1?.unlocks || {}).length);

  console.log('\nTesting Super Mario World (2713503983)...');
  const raw2 = await evaluate(`
    Millennium.callServerMethod('steam-cartridges-dev', 'CartridgesAchievementsGet', {
      payload: JSON.stringify({ shortcut_appid: 2713503983 })
    })
  `);
  const res2 = typeof raw2 === 'string' ? JSON.parse(raw2) : raw2;
  console.log('SMW GameID:', res2?.schema?.ra_game_id);
  console.log('SMW Title:', res2?.schema?.title);
  console.log('SMW Total:', res2?.schema?.total);
  console.log('SMW Achievements in array:', res2?.schema?.achievements?.length);
  console.log('SMW Unlocks count:', Object.keys(res2?.unlocks || {}).length);

  ws.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
