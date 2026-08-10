import { Message } from "chat";

async function createMessageStep(value: string): Promise<Message> {
  "use step";

  return new Message({
    id: "message",
    threadId: "slack:C123:123.456",
    text: value,
    formatted: {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value }],
        },
      ],
    },
    raw: {},
    author: {
      userId: "U123",
      userName: "user",
      fullName: "User",
      isBot: false,
      isMe: false,
    },
    metadata: {
      dateSent: new Date(),
      edited: false,
    },
    attachments: [],
  });
}

export async function testWorkflow(value: string): Promise<string> {
  "use workflow";

  const message = await createMessageStep(value);
  return message.text;
}
