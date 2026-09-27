// scratch/test_duckstation_observer.mjs
import fs from 'fs';

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
  const logPath = 'C:/emu/duckstation/duckstation.log';
  const initialLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '';

  try {
    console.log('1. Ensuring SotN schema is loaded (shortcut 2162501062)...');
    await evaluate(`
      Millennium.callServerMethod('steam-cartridges-dev', 'CartridgesAchievementsGet', {
        payload: JSON.stringify({ shortcut_appid: 2162501062 })
      })
    `);

    // Reset unlocks first to start clean
    await evaluate(`
      Millennium.callServerMethod('steam-cartridges-dev', 'CartridgesAchievementsReset', {
        payload: JSON.stringify({ shortcut_appid: 2162501062 })
      })
    `);

    console.log('2. Simulating DuckStation unlock in duckstation.log for achievement 82635 ("What is a Man?")...');
    fs.appendFileSync(logPath, '\n[Cheevos] Awarded achievement 82635\n');

    console.log('3. Calling CartridgesAchievementsCheckUnlocks...');
    const rawCheck = await evaluate(`
      Millennium.callServerMethod('steam-cartridges-dev', 'CartridgesAchievementsCheckUnlocks', {
        payload: JSON.stringify({ shortcut_appid: 2162501062 })
      })
    `);
    console.log('rawCheck type:', typeof rawCheck, 'rawCheck value:', rawCheck);
    const checkRes = typeof rawCheck === 'string' ? JSON.parse(rawCheck) : rawCheck;
    console.log('Observer detected new unlocks:', checkRes?.new_unlocks?.length);
    console.log('Detected achievement:', checkRes?.new_unlocks?.[0]);

    if (checkRes?.new_unlocks?.[0]?.id === '82635') {
      console.log('\n[PASS] Successfully detected DuckStation unlock out-of-process!');
    } else {
      console.error('\n[FAIL] Failed to detect DuckStation unlock');
      process.exitCode = 1;
    }

    console.log('\n4. Verifying achievements_store state...');
    const rawGet = await evaluate(`
      Millennium.callServerMethod('steam-cartridges-dev', 'CartridgesAchievementsGet', {
        payload: JSON.stringify({ shortcut_appid: 2162501062 })
      })
    `);
    const getRes = typeof rawGet === 'string' ? JSON.parse(rawGet) : rawGet;
    console.log('Stored unlocks count:', Object.keys(getRes?.unlocks || {}).length);
    console.log('Unlock 82635 recorded:', Boolean(getRes?.unlocks?.['82635']));

  } finally {
    // Clean up
    if (initialLog) {
      fs.writeFileSync(logPath, initialLog);
    } else if (fs.existsSync(logPath)) {
      fs.unlinkSync(logPath);
    }
    // Reset state back to clean
    await evaluate(`
      Millennium.callServerMethod('steam-cartridges-dev', 'CartridgesAchievementsReset', {
        payload: JSON.stringify({ shortcut_appid: 2162501062 })
      })
    `);
    ws.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
