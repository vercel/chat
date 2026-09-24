[![Gmail adapter for Chat SDK](https://chat-sdk.dev/en/adapters/official/gmail/og)](https://chat-sdk.dev/adapters/official/gmail)

# @chat-adapter/gmail

> npm package: [`@chat-adapter/gmail`](https://www.npmjs.com/package/@chat-adapter/gmail)

Gmail primitives and an optional Chat SDK adapter for authenticated mailbox notifications and threaded email replies.

Documentation: [Gmail adapter](https://chat-sdk.dev/adapters/official/gmail) | Guides: [Chat SDK](https://vercel.com/kb/chat-sdk)

## Installation

```bash
pnpm add @chat-adapter/gmail
```

## Scaffold with the CLI

To scaffold a new Gmail bot with this adapter and Redis state preselected:

```bash
npx create-chat-sdk@latest my-bot --adapter gmail redis
```

Visit the [adapters directory](https://chat-sdk.dev/adapters) to see other available official and vendor-official adapters.

Follow the [Gmail guide](https://chat-sdk.dev/adapters/official/gmail) for OAuth, authenticated Pub/Sub delivery and watch renewal. The standalone APIs do not require a Chat instance; the root adapter also needs persistent state and an intake label.

## import boundaries

| import | purpose | loads Chat |
| --- | --- | --- |
| `@chat-adapter/gmail/api` | OAuth token providers, messages, drafts, labels, history and watches | no |
| `@chat-adapter/gmail/format` | MIME parsing, composition and serializable reply context | no |
| `@chat-adapter/gmail/webhook` | Pub/Sub notification parsing and JWT verification | no |
| `@chat-adapter/gmail` | full Chat SDK adapter | yes |

The primitive entrypoints and their generated types do not import `chat`, `@chat-adapter/shared`, `ai`, or Google's full client SDK. They do not create handlers, subscriptions, locks, sessions, or background workers. The package still declares Chat dependencies for the optional root adapter; this is runtime isolation, not a separate installation footprint.

## without Chat

```typescript
import {
  createGmailDraft,
  createGmailTokenProvider,
  getGmailMessage,
} from "@chat-adapter/gmail/api";
import {
  extractGmailContinuation,
  parseGmailMessage,
} from "@chat-adapter/gmail/format";

const token = createGmailTokenProvider({
  clientId: process.env.GMAIL_CLIENT_ID!,
  clientSecret: process.env.GMAIL_CLIENT_SECRET!,
  refreshToken: process.env.GMAIL_REFRESH_TOKEN!,
});
const options = { mailbox: "agent@example.com", token };
const source = await getGmailMessage("native-message-id", options);
const email = await parseGmailMessage(source);
const continuation = extractGmailContinuation(email, options.mailbox);

const draft = await createGmailDraft({
  continuation,
  text: "Here is the proposed reply",
}, options);
```

An existing integration can supply its own token string or async token resolver instead of `createGmailTokenProvider`. API options also accept a fetch implementation and abort signal.

The built-in token provider refreshes before token expiry and shares simultaneous refresh requests. It does not run the initial consent flow or automatically replay API requests after authentication failures. Revoked refresh tokens require renewed consent; inspect `GmailApiError.reason` in standalone integrations. The root adapter reports rejected credentials as `AuthenticationError`. See [Google's OAuth error guidance](https://developers.google.com/identity/protocols/oauth2/web-server#authorization-errors).

Continuation data contains native Gmail IDs, mailbox, recipients, subject, and RFC reply headers. It is serializable and has no Chat subscription or session dependency. Reply-To is preferred over From; other recipients are not copied automatically. Treat email content and sender headers as untrusted input, not authorization to execute tools or send mail.

For reply-all, use `extractGmailContinuation(email, mailbox, { replyAll: true })`. It includes the original To and Cc recipients, excludes the configured mailbox and duplicates, and never copies Bcc. It does not discover mailbox aliases or expand mailing lists. Review the resulting recipients before sending sensitive content. Outgoing messages can also specify explicit `to` and `cc` arrays.

For a private reply in the same conversation, pass the continuation with `to: [{ address: recipient }]` and `cc: []` to `sendGmailMessage` or `createGmailDraft`. This preserves the subject and reply headers without copying the continuation's recipients. Add a visible private notice to the body. Keep the original continuation separately if you intend to return to the original group later.

`createGmailDraft` saves a draft. `sendGmailMessage` sends immediately. The caller owns approvals, routing, persistence and retry policy. The API does not automatically retry sending email.

Both methods also accept a provider-native `{ raw, threadId? }` object when the caller already has a base64url-encoded MIME message. When constructing raw replies, the caller must include matching Subject, In-Reply-To and References headers as required by [Google's threading contract](https://developers.google.com/workspace/gmail/api/guides/threads).

### native events and history

An integration that owns its sessions can use the primitives without the root adapter's label filtering or message coalescing. `createGmailWebhookVerifier` returns decoded notification fields plus the original wrapped Pub/Sub `envelope`, including delivery metadata. It verifies transport identity and the configured subscription but does not load messages, change a cursor or dispatch a handler. Check `event.emailAddress` against the mailbox authorized for the route before accessing that mailbox. `parseGmailNotification` only parses; it does not authenticate requests.

After verification, the application can durably enqueue the event and acknowledge it, or finish processing before acknowledging. Do not acknowledge fire-and-forget work that can disappear when the request ends. The application owns duplicate handling, mailbox-level serialization and checkpoint persistence.

`listGmailHistory` returns one page of native changes: `messagesAdded`, `messagesDeleted`, `labelsAdded`, `labelsRemoved` and the general `messages` references. Message references retain `labelIds` when Google supplies them. Use the specific change arrays to avoid processing the same message twice; deleting a message differs from adding the `TRASH` label. There is no implicit message hydration.

```typescript
import {
  type GmailApiOptions,
  type GmailHistory,
  listGmailHistory,
} from "@chat-adapter/gmail/api";

async function catchUp(
  startHistoryId: string,
  options: GmailApiOptions,
  consume: (changes: GmailHistory["history"]) => Promise<void>,
) {
  let pageToken: string | undefined;
  let cursor = startHistoryId;
  do {
    const page = await listGmailHistory({ startHistoryId, pageToken }, options);
    await consume(page.history);
    cursor = page.historyId;
    pageToken = page.nextPageToken;
  } while (pageToken);
  return cursor;
}
```

Persist the returned cursor only after every page has been handled durably. A notification's `historyId` is a wake-up watermark, not a replacement for the saved cursor. History IDs and page tokens remain strings. History is ordered by mailbox changes, not email date; it includes sent and received mail according to the selected filters. The application chooses what warrants a turn and loads only needed content with `getGmailMessage` and `parseGmailMessage`. `getGmailThread` returns ordered message pointers, not hydrated email bodies.

History retention is limited. An expired `startHistoryId` returns `GmailApiError` with status `404`; standalone integrations must perform their own full synchronization. To bootstrap or recover, capture a fresh profile cursor before scanning current messages, reconcile the scan, then catch up from that cursor. The primitives do not hide this decision or silently reset state. See [Google's synchronization guide](https://developers.google.com/workspace/gmail/api/guides/sync).

`listGmailMessages({ q, labelId, includeSpamTrash, maxResults, pageToken }, options)` searches current mailbox contents and returns pointers, `nextPageToken` and an optional `resultSizeEstimate`. Every filter is optional, so `{}` lists across the mailbox. Search uses Gmail's native `q` syntax and requires a scope such as `gmail.readonly`; `gmail.metadata` does not allow `q`. Search is not a history of deletions. `listGmailHistory` accepts optional `historyTypes`, `labelId`, `maxResults` and `pageToken`. Both list calls return one page, default to 100 records and allow up to 500; the caller decides whether to continue.

`watchGmailMailbox({ topicName }, options)` watches the whole mailbox; pass `labelId` to restrict notifications. It returns the watch cursor and expiration but does not import mail or schedule renewal. The root Chat adapter still requires its intake label. See [message listing](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list), [history listing](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list) and [watch configuration](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch).

## with Chat

```typescript
import { createGmailAdapter } from "@chat-adapter/gmail";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat } from "chat";

const gmail = createGmailAdapter();
const bot = new Chat({
  userName: "agent",
  adapters: { gmail },
  state: createMemoryState(),
});

bot.onNewMention(async (thread) => {
  await thread.post("Received, I will review this email");
});
```

The root adapter currently uses label-based handoff. It coalesces selected emails from the same conversation within one synchronization run into the newest incoming message. Older messages remain available through thread history. Use durable state in production; in-memory state is only suitable for local experiments.

The selected label controls dispatch, not OAuth access to the mailbox. `thread.post()` sends email immediately. Streaming buffers text and sends once; sent email cannot be edited or retracted. Bridges that implement their own post/edit streaming must disable that behavior for email.

### replies and private delivery

Replies target Reply-To, otherwise From. Set `createGmailAdapter({ replyAll: true })` to include the original To and Cc recipients in `thread.post()` and `thread.reply()`. Sender-only replies remain the default. Email can include external recipients, so the adapter reports channel visibility as `unknown`, not as an authorization or privacy guarantee.

Gmail has no native ephemeral messages. Opt into private email delivery to one explicit address while preserving the conversation's subject and reply headers:

```typescript
bot.onNewMention(async (thread, message) => {
  await thread.postEphemeral(message.author, "Please review this request", {
    fallbackToDM: true,
  });
});
```

This sends a permanent email in the same Gmail thread only to the supplied address, with no Cc or Bcc, and prefixes the body with `(private only)`. The result has `usedFallback: true` and Gmail's actual thread ID. `fallbackToDM: false` returns `null` without sending, including direct adapter calls with no fallback option. From a channel or a recipient route without a native Gmail thread, it starts a new email with the subject `Private message`.

During a handler, the incoming message supplies the reply context. Outside a handler, the latest incoming message in the thread supplies it. With `replyAll: true`, use `thread.reply(originalMessageId, message)` to return to the original group after a private exchange; replying to the latest private email does not restore earlier recipients. The adapter never automatically quotes earlier bodies or copies attachments. Thread history can still contain both private and group messages: applications must prevent private content from entering later group replies or shared model context. A private notice does not prevent forwarding.

An email's From header is not proof of the sender's identity; the application must choose a trusted recipient for approvals or credentials, including permission to see the original subject. Other email clients may group conversations differently.

For direct delivery, use `await gmail.postMessage(await gmail.openDM(address), message)`, or `bot.thread(await gmail.openDM(address)).post(message)`. `bot.openDM(address)` cannot infer an adapter from an email address. Opening a recipient route sends nothing; each post starts a new email and returns Gmail's actual thread ID. The route itself has no message history. Replies are received through their native Gmail threads and still require the intake label.

## setup

1. Enable the Gmail API and Pub/Sub in your Google Cloud project. Obtain user-context OAuth credentials for the mailbox. Request `gmail.readonly` for reading and watches, plus `gmail.send` for replies. Draft creation needs `gmail.compose`. The adapter does not need permission to delete email or modify labels. See [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).
2. Create a Pub/Sub topic in the same Google Cloud project as the OAuth client. Grant `gmail-api-push@system.gserviceaccount.com` permission to publish to that topic.
3. Create an authenticated, wrapped Pub/Sub push subscription. Set the webhook URL as its audience and configure a push service account. This account is distinct from Gmail's publisher account. The Pub/Sub service agent needs permission to mint an identity token for it. Follow [Google's authenticated push setup](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions).
4. Create a handoff label in Gmail and retrieve its ID with `listGmailLabels(options)` from `/api`, which uses [users.labels.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels/list). The label's display name is not its ID.
5. Configure the adapter, initialize Chat and register the watch. Renew the watch daily and run `gmail.sync()` periodically so dropped notifications do not leave the mailbox stale.

For example, with `PROJECT`, `PROJECT_NUMBER` and `WEBHOOK_URL` set for your deployment:

```sh
gcloud services enable gmail.googleapis.com pubsub.googleapis.com --project="$PROJECT"
gcloud beta services identity create --service=pubsub.googleapis.com --project="$PROJECT"
gcloud pubsub topics create gmail-events --project="$PROJECT"
gcloud pubsub topics add-iam-policy-binding gmail-events \
  --project="$PROJECT" \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"
gcloud iam service-accounts create gmail-push --project="$PROJECT"
gcloud iam service-accounts add-iam-policy-binding \
  "gmail-push@$PROJECT.iam.gserviceaccount.com" \
  --project="$PROJECT" \
  --member="serviceAccount:service-$PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"
gcloud pubsub subscriptions create gmail-webhook \
  --project="$PROJECT" \
  --topic=gmail-events \
  --push-endpoint="$WEBHOOK_URL" \
  --push-auth-service-account="gmail-push@$PROJECT.iam.gserviceaccount.com" \
  --push-auth-token-audience="$WEBHOOK_URL"
```

The operator also needs permission to create these resources and `iam.serviceAccounts.actAs` on the push account. Ensure the Pub/Sub service agent exists before granting it token-creator access. Keep the subscription wrapped, and configure the adapter with the same subscription, audience and push account. If your webhook has an additional platform authentication layer, configure that separately.

| config | environment |
| --- | --- |
| `mailbox` | `GMAIL_MAILBOX` |
| `labelId` | `GMAIL_LABEL_ID` |
| `clientId` | `GMAIL_CLIENT_ID` |
| `clientSecret` | `GMAIL_CLIENT_SECRET` |
| `refreshToken` | `GMAIL_REFRESH_TOKEN` |
| `accessToken` | `GMAIL_ACCESS_TOKEN` |
| `pubsubAudience` | `GMAIL_PUBSUB_AUDIENCE` |
| `pubsubServiceAccountEmail` | `GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL` |
| `subscription` | `GMAIL_SUBSCRIPTION` |
| `topicName` | `GMAIL_TOPIC_NAME` |
| `replyAll` | `GMAIL_REPLY_ALL` |

Use either the OAuth client/refresh-token configuration or `accessToken`. A token resolver is recommended when another system already manages refresh. Explicit OAuth configuration takes precedence over an environment access token. The mailbox is an email address, the subscription is `projects/PROJECT/subscriptions/SUBSCRIPTION`, and the topic is `projects/PROJECT/topics/TOPIC`.

Use the actual mailbox address, not Gmail's `me` shorthand. The adapter uses it to validate notifications and isolate persisted state.

`GMAIL_REPLY_ALL` enables reply-all only when its value is exactly `true`. An explicit `replyAll` configuration value takes precedence.

```typescript
await bot.initialize();
await gmail.watch();
await gmail.sync();
```

Expose `bot.webhooks.gmail(request)` from your POST route. The adapter acknowledges only after synchronization completes. The application owns scheduling; importing the package does not start a worker. Stopping the application does not unregister the mailbox watch. Call `stopGmailMailbox(options)` from `/api` when disconnecting the mailbox permanently. This uses [users.stop](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/stop), which stops mailbox notifications, not just notifications for the selected label. Stop renewal and sync jobs too; this call does not delete application state or revoke OAuth consent.

Google recommends daily renewal and requires renewal at least every seven days. A watch can emit a notification immediately, so the route must already be available. See [push delivery and renewal](https://developers.google.com/workspace/gmail/api/guides/push).

`watch()` registers or renews notifications and returns Google's expiration timestamp; it does not process messages. Calling `sync()` afterwards catches up from an existing saved cursor. On first setup, the cursor starts at watch registration, so this does not import pre-existing labelled email. There is no background renewal timer: schedule daily `watch()` calls and periodic `sync()` calls in your application.

### custom webhook verification

`webhookVerifier?: (request: Request) => unknown | Promise<unknown>` can authenticate a trusted forwarding service instead of Google's JWT. A truthy result accepts the request; a falsy result or exception rejects it. The verifier receives a readable request body and may consume it. It takes precedence over `pubsubAudience` and `pubsubServiceAccountEmail`, which are not required in this mode. Without a custom verifier, native Pub/Sub JWT verification remains required.

The override changes authentication only. The payload must still be a wrapped Pub/Sub notification, with the configured `subscription` and mailbox. Payload size limits and parsing remain enforced. Do not use an always-true verifier on a public endpoint.

## delivery semantics

- Initial watch registration starts from Google's returned cursor, not the existing inbox. Renewal preserves the saved cursor. Expired history triggers a scan of currently labelled messages; this can include older labelled email that has never been dispatched.
- [Gmail labels belong to messages](https://developers.google.com/workspace/gmail/api/guides/labels). Applying a conversation label affects its existing messages. Future replies do not inherit the label. Label those replies explicitly or use a Gmail filter; subscribing to a Chat thread does not change Gmail's labels.
- Sent messages, drafts, spam and trash are excluded. Label checks happen before body retrieval and again before dispatch. Notifications are hints to read history, not message contents or trusted cursor updates.
- Durable receipts suppress previously dispatched and superseded messages. Coalescing is per synchronization run, not a guarantee of one callback per human UI action. Removing and reapplying a label does not replay a message already recorded as handled.
- When multiple selected messages belong to one conversation, synchronization reads only its ordered message IDs before selecting the latest eligible message. History is ordered by mailbox changes, which may label older messages later; it is not a substitute for message order. A single selected message needs no thread lookup.
- Oversized responses and MIME parser failures are recorded separately as failed messages. Later conversations continue syncing; the adapter does not fall back to an older selected email from the failed conversation. Failed messages are not automatically fetched again, including during expired-history recovery.
- A rejected Chat handoff is also recorded as failed, not delivered. The adapter logs the native message ID, thread ID and a reason (`size`, `format` or `handler`) without including message content in that failure log. Chat's own logging configuration still applies. Monitor these errors and use the native IDs to inspect or recover the affected email explicitly.
- Chat's deduplication and concurrency semantics still apply. Failed handlers are not automatically replayed, since a handler might already have sent email before throwing. Persist application work and manage retries explicitly; use the primitives when the application owns its delivery pipeline. Removing and reapplying the label does not retry a recorded failure.
- Authentication, rate-limit and network errors during mailbox reads, and errors persisting synchronization state, still stop synchronization without advancing its cursor. A successful webhook acknowledgment means the changes have been accounted for, including recorded failures, not that every application handler succeeded.
- Sending is not transactional with state updates. A timeout or process failure can leave the sending outcome uncertain. Reconcile before retrying a send; neither the adapter nor Gmail's acceptance response proves final recipient delivery.
- MIME input and output are capped at 25 MiB by this package, with a 1 MiB buffered-stream text cap. These are local safety limits, not Gmail account or attachment quota claims.

The adapter does not implement an in-Gmail button, domain-wide deployment, outbound delivery tracking, or approval UI. Email headers and content must not be treated as authorization for privileged tools.

## OAuth deployment

Mailbox-read access is a restricted scope. Production deployments must assess Google's verification and security-assessment requirements, including applicable exceptions for internal or test applications. Keep token material and email content out of logs, and apply appropriate retention and deletion policies to application state. See [restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) and the [Workspace API data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy).

## verification

Local tests exercise MIME, native API contracts, JWT verification, synchronization, Chat dispatch and import boundaries. A subprocess blocks Chat runtime imports while using the built primitive exports. Source and generated declaration graphs are checked separately. The authenticated integration test uses locally generated keys and mocked Gmail responses, not real Google credentials.

Verify delivery with your own mailbox and authenticated Pub/Sub subscription after configuration. A successful API request alone does not verify end-to-end delivery.

## Google references

- [Sending messages](https://developers.google.com/workspace/gmail/api/guides/sending)
- [Reply threading requirements](https://developers.google.com/workspace/gmail/api/guides/threads)
- [Mailbox push notifications and watch renewal](https://developers.google.com/workspace/gmail/api/guides/push)
- [History synchronization and expired cursors](https://developers.google.com/workspace/gmail/api/guides/sync)
- [Authenticated Pub/Sub delivery](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions)
- [OAuth scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)

## AI Coding Agents

Install the Chat SDK skill with `npx skills add vercel/chat`. Agent-readable documentation is available at [llms.txt](https://chat-sdk.dev/llms.txt) and [llms-full.txt](https://chat-sdk.dev/llms-full.txt).
