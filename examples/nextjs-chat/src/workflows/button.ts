import { Actions, Button, Card, CardText, emoji, type Thread } from "chat";
import { createWebhook } from "workflow";

export async function buttonWorkflow(thread: Thread<unknown>) {
  "use workflow";

  using webhook = createWebhook();

  await postButtonCard(thread, webhook.url);

  const request = await webhook;
  const payload = await request.json();

  await postConfirmation(thread, payload.user?.name ?? "someone");
}

async function postButtonCard(thread: Thread<unknown>, callbackUrl: string) {
  "use step";
  await thread.post(
    Card({
      title: `${emoji.rocket} Workflow Button Demo`,
      children: [
        CardText(
          "This button uses a **workflow webhook** as its `callbackUrl`. Click it and the workflow resumes!"
        ),
        Actions([
          Button({
            id: "workflow_confirm",
            label: "Confirm",
            callbackUrl,
            style: "primary",
          }),
        ]),
      ],
    })
  );
}

async function postConfirmation(thread: Thread<unknown>, userName: string) {
  "use step";
  await thread.post(
    `${emoji.check} **${userName}** clicked the workflow button!`
  );
}
