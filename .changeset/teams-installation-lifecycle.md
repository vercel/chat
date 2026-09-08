---
"chat": minor
"@chat-adapter/teams": minor
"@chat-adapter/tests": minor
---

Add `onInstalled` and `onUninstalled` handlers for installation lifecycle events. The Teams adapter emits them for `installationUpdate` activities, including the `add-upgrade` and `remove-upgrade` actions, with a persistable `channelId` for later proactive messages.

The Teams adapter now sends, edits, deletes, reacts, and types against the service URL encoded in the thread ID instead of the app-wide default, so conversations hosted on regional or sovereign Bot Framework endpoints are reached correctly. An explicit `apiUrl` still pins every call to that endpoint.
