// The one function that calls the backend (migration plan M4c; moved from rpc.ts
// verbatim). rpc.ts and ports/backend.ts both call through this.
export async function call<R>(name: string, payload: object = {}): Promise<R> {
  const millennium = (window as any)['Millennium'];
  const callFn = millennium ? millennium['callServerMethod'] : undefined;
  const candidatePlugins = ['steam-cartridges-dev', 'steam-cartridges'];
  let lastError: any;
  for (const plugin of candidatePlugins) {
    try {
      if (typeof callFn === 'function') {
        const raw = await callFn.call(millennium, plugin, name, {
          payload: JSON.stringify(payload),
        });
        return JSON.parse(raw as string) as R;
      }
    } catch (err: any) {
      lastError = err;
      if (String(err).includes('plugin not running')) {
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
