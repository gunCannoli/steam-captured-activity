import { Logger } from 'steambrew-utils/logger';
import { rpc } from './rpc';

export const logger = new Logger('Non-Steam Games Activity');

/**
 * Plugin entry point. Millennium calls this once the backend reports ready.
 *
 * Phase 3 deliberately does nothing but prove the round trip: if the expected
 * counts appear in the Steam console, the whole backend works in situ and the
 * UI phases can build on it. Renderers arrive in Phase 4.
 */
export default async function OnPluginLoaded() {
  try {
    const diagnostics = await rpc.getDiagnostics();

    if (!diagnostics.ok) {
      logger.error('Backend could not read Steam:', diagnostics.error);
      return;
    }

    logger.info(
      `Ready. ${diagnostics.shortcuts} shortcuts, ` +
        `${diagnostics.screenshots} screenshots across ` +
        `${diagnostics.games_with_media} non-Steam games.`,
      diagnostics,
    );
  } catch (error) {
    // Never throw out of the load hook - a plugin that fails to load should
    // leave Steam untouched, not break the client.
    logger.error('Failed to reach the backend:', error);
  }
}
