import {
  Actions,
  Button,
  Card,
  type CardChild,
  type CardElement,
  Text,
} from "../cards";

export const APPROVE_ACTION_ID = "approve";
export const DENY_ACTION_ID = "deny";

/** Options describing the approval card posted by `requestApproval`. */
export interface ApprovalCardOptions {
  /** Label for the approve button. Default: "Approve" */
  approveLabel?: string;
  /** Label for the deny button. Default: "Deny" */
  denyLabel?: string;
  /** Optional body text (markdown) rendered above the fields */
  description?: string;
  /** Key/value pairs rendered as a bold-label list on the card */
  fields?: Record<string, string>;
  /** Optional subtitle rendered under the title */
  subtitle?: string;
  /** Card title, e.g. "Deploy v1.2.3?" */
  title: string;
}

function buildBody(options: ApprovalCardOptions): CardChild[] {
  const children: CardChild[] = [];
  if (options.description) {
    children.push(Text(options.description));
  }
  if (options.fields) {
    const lines = Object.entries(options.fields).map(
      ([key, value]) => `**${key}:** ${value}`
    );
    if (lines.length > 0) {
      children.push(Text(lines.join("\n")));
    }
  }
  return children;
}

/**
 * Build the pending approval card: body content plus Approve/Deny buttons
 * that POST the click to `webhookUrl`.
 */
export function buildApprovalCard(
  options: ApprovalCardOptions,
  webhookUrl: string
): CardElement {
  return Card({
    title: options.title,
    subtitle: options.subtitle,
    children: [
      ...buildBody(options),
      Actions([
        Button({
          id: APPROVE_ACTION_ID,
          label: options.approveLabel ?? "Approve",
          style: "primary",
          callbackUrl: webhookUrl,
        }),
        Button({
          id: DENY_ACTION_ID,
          label: options.denyLabel ?? "Deny",
          style: "danger",
          callbackUrl: webhookUrl,
        }),
      ]),
    ],
  });
}

/**
 * Build the resolved approval card: same body with the buttons replaced by
 * a static outcome line, leaving an audit trail in the thread.
 */
export function buildResolvedCard(
  options: ApprovalCardOptions,
  outcome: string
): CardElement {
  return Card({
    title: options.title,
    subtitle: options.subtitle,
    children: [...buildBody(options), Text(outcome)],
  });
}
