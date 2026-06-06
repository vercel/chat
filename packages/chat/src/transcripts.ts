/**
 * @deprecated The Transcripts API has been superseded by the unified History
 * API (`chat.history.user`).  Import from `./history/user` or use
 * `chat.history.user` at runtime.
 *
 * This module is preserved for backwards compatibility:
 * - `TranscriptsApiImpl` is a type alias of `UserHistoryApiImpl`
 * - All other types continue to re-export from `./types`
 */

export { UserHistoryApiImpl as TranscriptsApiImpl } from "./history/user";
