// scratch/test_retro_status_rpc.mjs
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

  console.log('Querying CartridgesAchievementsGetRetroStatus...');
  const raw = await evaluate(`
    Millennium.callServerMethod('steam-cartridges-dev', 'CartridgesAchievementsGetRetroStatus', {
      payload: '{}'
    })
  `);
  const res = typeof raw === 'string' ? JSON.parse(raw) : raw;
  console.log('Retro Status Result:', JSON.stringify(res, null, 2));

  console.log('\nTesting Test Retro Toast event dispatch...');
  const toastResult = await evaluate(`
    (() => {
      window.dispatchEvent(new CustomEvent('cartridges:trigger_fake_achievement', {
        detail: {
          shortcutAppId: 2713503983,
          achievement: {
            id: 'retro_test_manual',
            name: 'Retro Champion',
            description: 'Phase 4 verified: Test Retro Toast notification!',
            icon: 'https://media.retroachievements.org/Badge/00001.png',
            global_pct: 100
          }
        }
      }));
      return 'Event dispatched';
    })()
  `);
  console.log('Toast Result:', toastResult);

  ws.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
