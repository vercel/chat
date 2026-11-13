import type { AdaptiveCard } from "@microsoft/teams.cards";
import type { cardToAdaptiveCard } from "./cards";
import type { TeamsPostableMessage } from "./types";

// Type-level tests, checked by `pnpm typecheck`. Vitest strips types, so a
// runtime test can't see a card type that stops compiling.

type Expect<T extends true> = T;
type Accepts<Card> = { adaptiveCard: Card } extends TeamsPostableMessage
  ? true
  : false;

interface InterfaceTypedCard {
  body: unknown[];
  type: "AdaptiveCard";
  version: string;
}

export type RawAdaptiveCardTypes = [
  Expect<Accepts<AdaptiveCard>>,
  Expect<Accepts<ReturnType<typeof cardToAdaptiveCard>>>,
  Expect<Accepts<InterfaceTypedCard>>,
  Expect<Accepts<{ type: string; body: { type: string }[] }>>,
  // @ts-expect-error a card is an object, never a string
  Expect<Accepts<string>>,
  // @ts-expect-error a card can't be undefined
  Expect<Accepts<undefined>>,
  // @ts-expect-error a card can't be null
  Expect<Accepts<null>>,
];
