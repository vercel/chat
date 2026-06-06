/**
 * @deprecated The Transcripts API has been superseded by the unified History
 * API (`chat.history.user`). Import from `./history/user` or use
 * `chat.history.user` at runtime.
 *
 * This module is preserved for backwards compatibility — it re-exports
 * {@link UserHistoryApiImpl} as `TranscriptsApiImpl`. Related types
 * (`TranscriptsApi`, `TranscriptEntry`, etc.) are exported from the package
 * root via `./types`, not from this module.
 */

export { UserHistoryApiImpl as TranscriptsApiImpl } from "./history/user";
