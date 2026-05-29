/**
 * Compact callback_data encoding for menu navigation.
 *
 * Telegram caps callback_data at 64 bytes (per inline_keyboard button).
 * Short keys ("nav", "run", "act") and short demo IDs keep every payload
 * well under the limit and far from the adapter's 64-byte ValidationError.
 */

export type MenuCallback =
  | { kind: "nav"; menu: string }
  | { kind: "run"; demo: string }
  | { kind: "act"; demo: string; arg: string };

export function encode(cb: MenuCallback): string {
  if (cb.kind === "nav") {
    return `nav:${cb.menu}`;
  }
  if (cb.kind === "run") {
    return `run:${cb.demo}`;
  }
  return `act:${cb.demo}:${cb.arg}`;
}

export function decode(raw: string): MenuCallback | null {
  const parts = raw.split(":");
  const [kind, ...rest] = parts;

  if (kind === "nav" && rest.length === 1 && rest[0]) {
    return { kind: "nav", menu: rest[0] };
  }
  if (kind === "run" && rest.length === 1 && rest[0]) {
    return { kind: "run", demo: rest[0] };
  }
  if (kind === "act" && rest.length === 2 && rest[0] && rest[1]) {
    return { kind: "act", demo: rest[0], arg: rest[1] };
  }
  return null;
}
