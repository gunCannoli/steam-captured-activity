import { Logger } from "steambrew-utils/logger";

/** Shared logger, in its own module so every layer can import it without importing the entry point. */
export const logger = new Logger("Steam Captured Activity");
