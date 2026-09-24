import { Logger } from 'steambrew-utils/logger';

/**
 * Shared logger.
 *
 * Lives in its own module so hooks and components can import it without depending on the
 * entry point, which would otherwise create a cycle
 * (index -> banner -> index).
 */
export const logger = new Logger('Enhanced Achievements');
