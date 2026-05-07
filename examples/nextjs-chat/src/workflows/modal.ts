import { emoji, type Thread } from "chat";
import { createHook } from "workflow";
import { bot } from "../lib/bot";

interface ModalSubmitPayload {
  callbackId: string;
  user?: { id: string; name: string };
  values: Record<string, string>;
}

export async function modalWorkflow(
  thread: Thread<unknown>,
  token: string,
  userName: string
) {
  "use workflow";

  const hook = createHook<ModalSubmitPayload>({ token });
  const payload = await hook;

  await postConfirmation(thread, userName, payload.values);
}

async function postConfirmation(
  thread: Thread<unknown>,
  userName: string,
  values: Record<string, string>
) {
  "use step";
  bot.registerSingleton();
  const summary = Object.entries(values)
    .map(([k, v]) => `**${k}**: ${v}`)
    .join("\n");
  await thread.post(
    `${emoji.check} **${userName}** submitted the workflow modal:\n${summary}`
  );
}
