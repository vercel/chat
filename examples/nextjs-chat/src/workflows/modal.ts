import { Modal, Select, SelectOption, emoji, type Thread } from "chat";
import { createWebhook } from "workflow";

export async function modalWorkflow(thread: Thread<unknown>, triggerId: string) {
  "use workflow";

  using webhook = createWebhook();

  await openModalStep(thread, triggerId, webhook.url);

  const request = await webhook;
  const payload = await request.json();
  const choice = payload.values?.choice ?? "nothing";

  await postResultStep(thread, choice);
}

async function openModalStep(
  thread: Thread<unknown>,
  triggerId: string,
  callbackUrl: string
) {
  "use step";
  await thread.adapter.openModal?.(
    triggerId,
    Modal({
      callbackId: "workflow_modal_form",
      callbackUrl,
      title: "Pick an Option",
      submitLabel: "Submit",
      children: [
        Select({
          id: "choice",
          label: "Choose something",
          placeholder: "Select...",
          options: [
            SelectOption({ label: "Option A", value: "option_a" }),
            SelectOption({ label: "Option B", value: "option_b" }),
            SelectOption({ label: "Option C", value: "option_c" }),
          ],
        }),
      ],
    })
  );
}

async function postResultStep(thread: Thread<unknown>, choice: string) {
  "use step";
  await thread.post(`${emoji.check} You selected **${choice}**`);
}
