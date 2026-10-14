// One prefix for every line this plugin writes to Steam's JS console (SharedJSContext).
const PREFIX = "[steam-cartridges-third-party]";

export const logger = {
    info: (...args: unknown[]) => console.log(PREFIX, ...args),
    warn: (...args: unknown[]) => console.warn(PREFIX, ...args),
    error: (...args: unknown[]) => console.error(PREFIX, ...args),
};
