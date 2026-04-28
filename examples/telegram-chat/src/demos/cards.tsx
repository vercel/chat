/**
 * Card demos — interactive approval, callback-data size probe, link button.
 *
 * The approval card is edited in-place on button press: the
 * on-action handler calls adapter.editMessage(threadId, messageId, newCard)
 * to replace the original buttons with a decision status.
 *
 * The size-probe card deliberately includes one button whose callback_data
 * is well under the limit and one that exceeds Telegram's 64-byte cap,
 * teaching the constraint without hiding it.
 */

import {
  Actions,
  Button,
  Card,
  type CardElement,
  CardText,
  Divider,
  Field,
  Fields,
  LinkButton,
  Section,
  type Thread,
  toCardElement,
} from "chat";
import { encode } from "../lib/callbacks";

type AnyThread = Thread<unknown>;

export const APPROVAL_DEMO_ID = "card.approval";
const SIZE_PROBE_DEMO_ID = "card.size";
const LINK_DEMO_ID = "card.link";

const PENDING_APPROVAL_CARD = (
  <Card title="Order #1234">
    <Section>
      <CardText>**Approval needed** for order #1234.</CardText>
      <Fields>
        <Field label="Amount" value="$450.00" />
        <Field label="Customer" value="Alice Johnson" />
        <Field label="Submitted" value="Apr 20 · 14:30" />
      </Fields>
    </Section>
    <Divider />
    <Actions>
      <Button
        id={encode({ kind: "act", demo: APPROVAL_DEMO_ID, arg: "approve" })}
        style="primary"
      >
        Approve
      </Button>
      <Button
        id={encode({ kind: "act", demo: APPROVAL_DEMO_ID, arg: "reject" })}
        style="danger"
      >
        Reject
      </Button>
    </Actions>
  </Card>
);

const TELEGRAM_CALLBACK_DATA_LIMIT = 64;

const SAFE_BUTTON_ID = encode({
  kind: "act",
  demo: SIZE_PROBE_DEMO_ID,
  arg: "ok",
});
// What Telegram actually sees on the wire: the adapter wraps each button
// id in `chat:{"a":"..."}` before shipping, so the effective budget is
// ~13 bytes less than the raw Telegram cap.
const SAFE_PAYLOAD_WIRE_BYTES = `chat:{"a":"${SAFE_BUTTON_ID}"}`.length;

const OVERSIZE_ARG = "this-id-intentionally-long-to-exceed-the-64-byte-limit";
const OVERSIZE_BUTTON_ID = encode({
  kind: "act",
  demo: SIZE_PROBE_DEMO_ID,
  arg: OVERSIZE_ARG,
});
const OVERSIZE_PAYLOAD_WIRE_BYTES = `chat:{"a":"${OVERSIZE_BUTTON_ID}"}`.length;

const SAFE_SIZE_CARD = (
  <Card title="Size probe — safe payload">
    <Section>
      <CardText>
        Telegram caps `callback_data` at **{TELEGRAM_CALLBACK_DATA_LIMIT}
        bytes**. This button's id fits the budget (including the adapter's
        `chat:{"{}"}` envelope).
      </CardText>
      <Fields>
        <Field label="Button id" value={SAFE_BUTTON_ID} />
        <Field
          label="Wire bytes"
          value={`${SAFE_PAYLOAD_WIRE_BYTES} / ${TELEGRAM_CALLBACK_DATA_LIMIT}`}
        />
      </Fields>
    </Section>
    <Divider />
    <Actions>
      <Button id={SAFE_BUTTON_ID}>Tap to confirm</Button>
    </Actions>
  </Card>
);

const OVERSIZE_SIZE_CARD = (
  <Card title="Size probe — oversize payload">
    <Section>
      <CardText>
        Same encoding, longer arg, cap exceeded. This card will NOT post — the
        SDK throws `ValidationError` at post time so the bug surfaces at the
        line that constructed the button, not later at runtime.
      </CardText>
      <Fields>
        <Field label="Button id" value={OVERSIZE_BUTTON_ID} />
        <Field
          label="Wire bytes"
          value={`${OVERSIZE_PAYLOAD_WIRE_BYTES} / ${TELEGRAM_CALLBACK_DATA_LIMIT} (over by ${OVERSIZE_PAYLOAD_WIRE_BYTES - TELEGRAM_CALLBACK_DATA_LIMIT})`}
        />
      </Fields>
    </Section>
    <Divider />
    <Actions>
      <Button id={OVERSIZE_BUTTON_ID}>Won't render</Button>
    </Actions>
  </Card>
);

const LINK_CARD = (
  <Card title="Link buttons">
    <Section>
      <CardText>
        {"`<LinkButton>` opens a URL directly. No callback handler runs."}
      </CardText>
    </Section>
    <Actions>
      <LinkButton url="https://github.com/vercel/chat">
        View on GitHub
      </LinkButton>
      <LinkButton url="https://vercel.com">Visit Vercel</LinkButton>
    </Actions>
  </Card>
);

export const CARD_DEMOS: {
  id: string;
  label: string;
  run: (thread: AnyThread) => Promise<void>;
}[] = [
  {
    id: APPROVAL_DEMO_ID,
    label: "Interactive approval card",
    run: async (thread) => {
      await thread.post(PENDING_APPROVAL_CARD);
    },
  },
  {
    id: SIZE_PROBE_DEMO_ID,
    label: "Button-size probe (64 B)",
    run: async (thread) => {
      // First: show the working case with bytecounts.
      await thread.post(SAFE_SIZE_CARD);

      // Then: attempt the oversize case. Expected to throw at post time —
      // that's the teaching moment, not a failure.
      try {
        await thread.post(OVERSIZE_SIZE_CARD);
        await thread.post(
          "⚠️ Unexpected: oversize card posted without error. Did the adapter limit change?"
        );
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        await thread.post({
          markdown: [
            "📎 **Expected ValidationError caught.**",
            "",
            `> ${msg}`,
            "",
            "The SDK refuses to ship malformed `callback_data` to Telegram. Alternatives the SDK could have chosen:",
            "",
            "- Silently truncate → button clicks would echo a truncated id that doesn't match any handler; silent runtime bug.",
            "- Hash + server-side lookup → needs stateful bookkeeping that survives bot restarts; higher ops cost.",
            "- **Throw at post time** → developer sees the failure at the line that caused it. (Chosen here.)",
            "",
            "Lesson: treat `callback_data` as a short routing key, never as app state. Store data elsewhere, keyed by a short id.",
          ].join("\n"),
        });
      }
    },
  },
  {
    id: LINK_DEMO_ID,
    label: "LinkButton card",
    run: async (thread) => {
      await thread.post(LINK_CARD);
    },
  },
];

export function buildDecidedCard(
  decision: "approve" | "reject",
  user: string,
  when: Date
): CardElement {
  const label = decision === "approve" ? "✅ Approved" : "🚫 Rejected";
  const time = `${when.getHours().toString().padStart(2, "0")}:${when
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
  const jsx = (
    <Card title="Order #1234">
      <Section>
        <CardText>
          {label} by @{user} at {time}.
        </CardText>
        <Fields>
          <Field label="Amount" value="$450.00" />
          <Field label="Customer" value="Alice Johnson" />
          <Field
            label="Decision"
            value={decision === "approve" ? "Approved" : "Rejected"}
          />
        </Fields>
      </Section>
    </Card>
  );
  const card = toCardElement(jsx);
  if (!card) {
    throw new Error("buildDecidedCard: toCardElement returned null");
  }
  return card;
}
