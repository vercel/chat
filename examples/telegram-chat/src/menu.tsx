/**
 * Menu tree: three top-level categories, each with its own sub-menu.
 *
 * Menus are inline-keyboard cards. Telegram lays out buttons inside one
 * <Actions> block on a single row, which gets unreadable with more than
 * 3–4 items. Each menu button lives in its own <Actions> so every button
 * becomes a standalone row (vertical stack).
 */

import {
  Actions,
  Button,
  Card,
  CardText,
  type ChatElement,
  type Thread,
} from "chat";
import { CARD_DEMOS } from "./demos/cards";
import { MARKDOWN_DEMOS } from "./demos/markdown";
import { MEDIA_DEMOS } from "./demos/media";
import { encode } from "./lib/callbacks";

type AnyThread = Thread<unknown>;

const MAIN_MENU_ID = "main";
const TEXT_MENU_ID = "text";
const CARDS_MENU_ID = "cards";
const MEDIA_MENU_ID = "media";

interface MenuItem {
  id: string;
  label: string;
}

/**
 * Wrap a list of {id,label} items as one <Actions> block per row, plus
 * a "← Back" row at the end.
 */
function renderRows(items: MenuItem[], parent: string): ChatElement[] {
  const rows = items.map((item) => (
    <Actions key={item.id}>
      <Button id={encode({ kind: "run", demo: item.id })}>{item.label}</Button>
    </Actions>
  ));
  rows.push(
    <Actions key="back">
      <Button id={encode({ kind: "nav", menu: parent })}>← Back</Button>
    </Actions>
  );
  return rows;
}

export async function postMainMenu(thread: AnyThread): Promise<void> {
  await thread.post(
    <Card title="Telegram Chat Demo">
      <CardText>Pick a category to explore the Chat SDK on Telegram.</CardText>
      <Actions>
        <Button id={encode({ kind: "nav", menu: TEXT_MENU_ID })}>
          Text & Markdown
        </Button>
      </Actions>
      <Actions>
        <Button id={encode({ kind: "nav", menu: CARDS_MENU_ID })}>
          Cards & Actions
        </Button>
      </Actions>
      <Actions>
        <Button id={encode({ kind: "nav", menu: MEDIA_MENU_ID })}>
          Media & Reactions
        </Button>
      </Actions>
    </Card>
  );
}

async function postTextMenu(thread: AnyThread): Promise<void> {
  await thread.post(
    <Card title="Text & Markdown">
      <CardText>MarkdownV2 rendering demos.</CardText>
      {renderRows(MARKDOWN_DEMOS, MAIN_MENU_ID)}
    </Card>
  );
}

async function postCardsMenu(thread: AnyThread): Promise<void> {
  await thread.post(
    <Card title="Cards & Actions">
      <CardText>Structured cards with inline keyboards.</CardText>
      {renderRows(CARD_DEMOS, MAIN_MENU_ID)}
    </Card>
  );
}

async function postMediaMenu(thread: AnyThread): Promise<void> {
  await thread.post(
    <Card title="Media & Reactions">
      <CardText>Attachments and emoji reactions.</CardText>
      {renderRows(MEDIA_DEMOS, MAIN_MENU_ID)}
    </Card>
  );
}

export async function postMenu(
  thread: AnyThread,
  menuId: string
): Promise<void> {
  if (menuId === TEXT_MENU_ID) {
    await postTextMenu(thread);
    return;
  }
  if (menuId === CARDS_MENU_ID) {
    await postCardsMenu(thread);
    return;
  }
  if (menuId === MEDIA_MENU_ID) {
    await postMediaMenu(thread);
    return;
  }
  await postMainMenu(thread);
}
