import type { CardElement } from "chat";
import { describe, expect, it } from "vitest";
import {
  cardToMessenger,
  cardToMessengerText,
  decodeMessengerCallbackData,
  encodeMessengerCallbackData,
} from "./cards";

describe("Messenger cards", () => {
  describe("text fallback rendering", () => {
    it("renders a simple card with title", () => {
      const card: CardElement = {
        type: "card",
        title: "Hello World",
        children: [],
      };
      const result = cardToMessengerText(card);
      expect(result).toBe("Hello World");
    });

    it("renders card with title and subtitle", () => {
      const card: CardElement = {
        type: "card",
        title: "Order #1234",
        subtitle: "Status update",
        children: [],
      };
      const result = cardToMessengerText(card);
      expect(result).toBe("Order #1234\nStatus update");
    });

    it("renders card with text content", () => {
      const card: CardElement = {
        type: "card",
        title: "Notification",
        children: [
          {
            type: "text",
            content: "Your order has been shipped!",
          },
        ],
      };
      const result = cardToMessengerText(card);
      expect(result).toBe("Notification\n\nYour order has been shipped!");
    });

    it("renders card with fields", () => {
      const card: CardElement = {
        type: "card",
        title: "Order Details",
        children: [
          {
            type: "fields",
            children: [
              { type: "field", label: "Order ID", value: "12345" },
              { type: "field", label: "Status", value: "Shipped" },
            ],
          },
        ],
      };
      const result = cardToMessengerText(card);
      expect(result).toContain("Order ID: 12345");
      expect(result).toContain("Status: Shipped");
    });

    it("renders card with link buttons as text with URLs", () => {
      const card: CardElement = {
        type: "card",
        title: "Actions",
        children: [
          {
            type: "actions",
            children: [
              {
                type: "link-button",
                url: "https://example.com/track",
                label: "Track Order",
              },
              {
                type: "link-button",
                url: "https://example.com/help",
                label: "Get Help",
              },
            ],
          },
        ],
      };
      const result = cardToMessengerText(card);
      expect(result).toContain("Track Order: https://example.com/track");
      expect(result).toContain("Get Help: https://example.com/help");
    });

    it("renders card with action buttons as bracketed text", () => {
      const card: CardElement = {
        type: "card",
        title: "Approve?",
        children: [
          {
            type: "actions",
            children: [
              {
                type: "button",
                id: "approve",
                label: "Approve",
                style: "primary",
              },
              {
                type: "button",
                id: "reject",
                label: "Reject",
                style: "danger",
              },
            ],
          },
        ],
      };
      const result = cardToMessengerText(card);
      expect(result).toContain("[Approve]");
      expect(result).toContain("[Reject]");
    });

    it("renders card with inline image", () => {
      const card: CardElement = {
        type: "card",
        title: "Image Card",
        children: [
          {
            type: "image",
            url: "https://example.com/image.png",
            alt: "Example image",
          },
        ],
      };
      const result = cardToMessengerText(card);
      expect(result).toContain("Example image: https://example.com/image.png");
    });

    it("renders image URL without alt text", () => {
      const card: CardElement = {
        type: "card",
        children: [
          {
            type: "image",
            url: "https://example.com/photo.jpg",
          },
        ],
      };
      const result = cardToMessengerText(card);
      expect(result).toBe("https://example.com/photo.jpg");
    });

    it("renders card with divider", () => {
      const card: CardElement = {
        type: "card",
        children: [
          { type: "text", content: "Before" },
          { type: "divider" },
          { type: "text", content: "After" },
        ],
      };
      const result = cardToMessengerText(card);
      expect(result).toContain("---");
    });

    it("renders card with section", () => {
      const card: CardElement = {
        type: "card",
        children: [
          {
            type: "section",
            children: [{ type: "text", content: "Section content" }],
          },
        ],
      };
      const result = cardToMessengerText(card);
      expect(result).toContain("Section content");
    });

    it("renders card with link element", () => {
      const card: CardElement = {
        type: "card",
        children: [
          {
            type: "link",
            url: "https://example.com",
            label: "Example Link",
          },
        ],
      };
      const result = cardToMessengerText(card);
      expect(result).toContain("Example Link: https://example.com");
    });

    it("renders card with table", () => {
      const card: CardElement = {
        type: "card",
        children: [
          {
            type: "table",
            headers: ["Name", "Age"],
            rows: [
              ["Alice", "30"],
              ["Bob", "25"],
            ],
          },
        ],
      };
      const result = cardToMessengerText(card);
      expect(result).toContain("Name | Age");
      expect(result).toContain("Alice | 30");
      expect(result).toContain("Bob | 25");
    });

    it("renders card imageUrl", () => {
      const card: CardElement = {
        type: "card",
        title: "Card with Header Image",
        imageUrl: "https://example.com/header.png",
        children: [],
      };
      const result = cardToMessengerText(card);
      expect(result).toContain("https://example.com/header.png");
    });
  });

  describe("template conversion", () => {
    describe("Generic Template", () => {
      it("produces template for card with title and buttons", () => {
        const card: CardElement = {
          type: "card",
          title: "Choose an action",
          children: [
            { type: "text", content: "What would you like to do?" },
            {
              type: "actions",
              children: [
                { type: "button", id: "btn_yes", label: "Yes" },
                { type: "button", id: "btn_no", label: "No" },
              ],
            },
          ],
        };
        const result = cardToMessenger(card);
        expect(result.type).toBe("template");
        if (result.type === "template") {
          expect(result.payload.template_type).toBe("generic");
          if (result.payload.template_type === "generic") {
            expect(result.payload.elements).toHaveLength(1);
            expect(result.payload.elements[0].title).toBe("Choose an action");
            expect(result.payload.elements[0].buttons).toHaveLength(2);
            expect(result.payload.elements[0].buttons?.[0].type).toBe(
              "postback"
            );
            expect(result.payload.elements[0].buttons?.[0].title).toBe("Yes");
          }
        }
      });

      it("produces template for card with imageUrl", () => {
        const card: CardElement = {
          type: "card",
          title: "Product",
          imageUrl: "https://example.com/product.jpg",
          children: [
            {
              type: "actions",
              children: [{ type: "button", id: "buy", label: "Buy Now" }],
            },
          ],
        };
        const result = cardToMessenger(card);
        expect(result.type).toBe("template");
        if (
          result.type === "template" &&
          result.payload.template_type === "generic"
        ) {
          expect(result.payload.elements[0].image_url).toBe(
            "https://example.com/product.jpg"
          );
        }
      });

      it("includes subtitle in generic template", () => {
        const card: CardElement = {
          type: "card",
          title: "Order #123",
          subtitle: "Your order is ready",
          children: [
            {
              type: "actions",
              children: [{ type: "button", id: "view", label: "View" }],
            },
          ],
        };
        const result = cardToMessenger(card);
        if (
          result.type === "template" &&
          result.payload.template_type === "generic"
        ) {
          expect(result.payload.elements[0].subtitle).toBe(
            "Your order is ready"
          );
        }
      });

      it("supports link buttons as web_url type", () => {
        const card: CardElement = {
          type: "card",
          title: "Resources",
          children: [
            {
              type: "actions",
              children: [
                {
                  type: "link-button",
                  url: "https://example.com/docs",
                  label: "View Docs",
                },
              ],
            },
          ],
        };
        const result = cardToMessenger(card);
        expect(result.type).toBe("template");
        if (
          result.type === "template" &&
          result.payload.template_type === "generic"
        ) {
          expect(result.payload.elements[0].buttons?.[0].type).toBe("web_url");
          expect(result.payload.elements[0].buttons?.[0].url).toBe(
            "https://example.com/docs"
          );
        }
      });

      it("mixes postback and web_url buttons", () => {
        const card: CardElement = {
          type: "card",
          title: "Options",
          children: [
            {
              type: "actions",
              children: [
                { type: "button", id: "action1", label: "Do Action" },
                {
                  type: "link-button",
                  url: "https://example.com",
                  label: "Learn More",
                },
              ],
            },
          ],
        };
        const result = cardToMessenger(card);
        if (
          result.type === "template" &&
          result.payload.template_type === "generic"
        ) {
          expect(result.payload.elements[0].buttons).toHaveLength(2);
          expect(result.payload.elements[0].buttons?.[0].type).toBe("postback");
          expect(result.payload.elements[0].buttons?.[1].type).toBe("web_url");
        }
      });
    });

    describe("Button Template", () => {
      it("produces template for card without title but with text and buttons", () => {
        const card: CardElement = {
          type: "card",
          children: [
            { type: "text", content: "Please select an option:" },
            {
              type: "actions",
              children: [
                { type: "button", id: "opt1", label: "Option 1" },
                { type: "button", id: "opt2", label: "Option 2" },
              ],
            },
          ],
        };
        const result = cardToMessenger(card);
        expect(result.type).toBe("template");
        if (result.type === "template") {
          expect(result.payload.template_type).toBe("button");
          if (result.payload.template_type === "button") {
            expect(result.payload.text).toBe("Please select an option:");
            expect(result.payload.buttons).toHaveLength(2);
          }
        }
      });

      it("builds body text from fields element", () => {
        const card: CardElement = {
          type: "card",
          children: [
            {
              type: "fields",
              children: [
                { type: "field", label: "Status", value: "Active" },
                { type: "field", label: "Priority", value: "High" },
              ],
            },
            {
              type: "actions",
              children: [{ type: "button", id: "ok", label: "OK" }],
            },
          ],
        };
        const result = cardToMessenger(card);
        expect(result.type).toBe("template");
        if (result.type === "template") {
          expect(result.payload.template_type).toBe("button");
          if (result.payload.template_type === "button") {
            expect(result.payload.text).toContain("Status: Active");
            expect(result.payload.text).toContain("Priority: High");
          }
        }
      });

      it("builds body text from link element", () => {
        const card: CardElement = {
          type: "card",
          children: [
            {
              type: "link",
              url: "https://example.com/docs",
              label: "Documentation",
            },
            {
              type: "actions",
              children: [{ type: "button", id: "view", label: "View" }],
            },
          ],
        };
        const result = cardToMessenger(card);
        expect(result.type).toBe("template");
        if (result.type === "template") {
          expect(result.payload.template_type).toBe("button");
          if (result.payload.template_type === "button") {
            expect(result.payload.text).toContain(
              "Documentation: https://example.com/docs"
            );
          }
        }
      });

      it("builds body text from section containing fields", () => {
        const card: CardElement = {
          type: "card",
          children: [
            {
              type: "section",
              children: [
                {
                  type: "fields",
                  children: [{ type: "field", label: "Name", value: "Test" }],
                },
              ],
            },
            {
              type: "actions",
              children: [{ type: "button", id: "submit", label: "Submit" }],
            },
          ],
        };
        const result = cardToMessenger(card);
        expect(result.type).toBe("template");
        if (result.type === "template") {
          expect(result.payload.template_type).toBe("button");
          if (result.payload.template_type === "button") {
            expect(result.payload.text).toContain("Name: Test");
          }
        }
      });
    });

    describe("constraint handling", () => {
      it("falls back to text for table nested in section", () => {
        const card: CardElement = {
          type: "card",
          title: "Nested Table",
          children: [
            {
              type: "section",
              children: [
                {
                  type: "table",
                  headers: ["A", "B"],
                  rows: [["1", "2"]],
                },
              ],
            },
            {
              type: "actions",
              children: [{ type: "button", id: "btn", label: "Click" }],
            },
          ],
        };
        const result = cardToMessenger(card);
        expect(result.type).toBe("text");
      });

      it("falls back to text when actions contain only select", () => {
        const card: CardElement = {
          type: "card",
          title: "Select Only",
          children: [
            {
              type: "actions",
              children: [
                {
                  type: "select",
                  id: "sel1",
                  label: "Choose one",
                  options: [
                    { label: "Option A", value: "a" },
                    { label: "Option B", value: "b" },
                  ],
                },
              ],
            },
          ],
        };
        const result = cardToMessenger(card);
        expect(result.type).toBe("text");
      });

      it("limits to 3 buttons max", () => {
        const card: CardElement = {
          type: "card",
          title: "Many buttons",
          children: [
            {
              type: "actions",
              children: [
                { type: "button", id: "btn1", label: "One" },
                { type: "button", id: "btn2", label: "Two" },
                { type: "button", id: "btn3", label: "Three" },
                { type: "button", id: "btn4", label: "Four" },
              ],
            },
          ],
        };
        const result = cardToMessenger(card);
        expect(result.type).toBe("template");
        if (
          result.type === "template" &&
          result.payload.template_type === "generic"
        ) {
          expect(result.payload.elements[0].buttons).toHaveLength(3);
        }
      });

      it("truncates long button titles to 20 chars", () => {
        const card: CardElement = {
          type: "card",
          title: "Long titles",
          children: [
            {
              type: "actions",
              children: [
                {
                  type: "button",
                  id: "btn_long",
                  label: "This is a very long button title",
                },
              ],
            },
          ],
        };
        const result = cardToMessenger(card);
        expect(result.type).toBe("template");
        if (
          result.type === "template" &&
          result.payload.template_type === "generic"
        ) {
          const buttonTitle = result.payload.elements[0].buttons?.[0].title;
          expect(buttonTitle?.length).toBeLessThanOrEqual(20);
          expect(buttonTitle).toContain("…");
        }
      });

      it("falls back to text for cards without buttons", () => {
        const card: CardElement = {
          type: "card",
          title: "Info only",
          children: [{ type: "text", content: "Just some info" }],
        };
        const result = cardToMessenger(card);
        expect(result.type).toBe("text");
      });

      it("falls back to text for cards with only link buttons and no title", () => {
        const card: CardElement = {
          type: "card",
          children: [
            {
              type: "actions",
              children: [
                {
                  type: "link-button",
                  url: "https://example.com",
                  label: "Visit",
                },
              ],
            },
          ],
        };
        const result = cardToMessenger(card);
        expect(result.type).toBe("text");
      });

      it("falls back to text for cards with select elements", () => {
        const card: CardElement = {
          type: "card",
          title: "With select",
          children: [
            {
              type: "actions",
              children: [
                {
                  type: "select",
                  id: "sel1",
                  label: "Choose",
                  options: [{ label: "A", value: "a" }],
                },
              ],
            },
          ],
        };
        const result = cardToMessenger(card);
        expect(result.type).toBe("text");
      });

      it("falls back to text for cards with radio_select elements", () => {
        const card: CardElement = {
          type: "card",
          title: "With radio",
          children: [
            {
              type: "actions",
              children: [
                {
                  type: "radio_select",
                  id: "radio1",
                  label: "Pick one",
                  options: [{ label: "X", value: "x" }],
                },
              ],
            },
          ],
        };
        const result = cardToMessenger(card);
        expect(result.type).toBe("text");
      });

      it("falls back to text for cards with table elements", () => {
        const card: CardElement = {
          type: "card",
          title: "With table",
          children: [
            {
              type: "table",
              headers: ["Col1", "Col2"],
              rows: [["A", "B"]],
            },
            {
              type: "actions",
              children: [{ type: "button", id: "btn", label: "Click" }],
            },
          ],
        };
        const result = cardToMessenger(card);
        expect(result.type).toBe("text");
      });

      it("truncates long subtitles to 80 chars", () => {
        const longSubtitle =
          "This is an extremely long subtitle that definitely exceeds the 80 character limit imposed by Messenger";
        const card: CardElement = {
          type: "card",
          title: "Test",
          subtitle: longSubtitle,
          children: [
            {
              type: "actions",
              children: [{ type: "button", id: "btn", label: "Click" }],
            },
          ],
        };
        const result = cardToMessenger(card);
        if (
          result.type === "template" &&
          result.payload.template_type === "generic"
        ) {
          const subtitle = result.payload.elements[0].subtitle;
          expect(subtitle?.length).toBeLessThanOrEqual(80);
          expect(subtitle).toContain("…");
        }
      });

      it("handles nested actions in sections", () => {
        const card: CardElement = {
          type: "card",
          title: "Nested",
          children: [
            {
              type: "section",
              children: [
                {
                  type: "actions",
                  children: [{ type: "button", id: "nested", label: "Nested" }],
                },
              ],
            },
          ],
        };
        const result = cardToMessenger(card);
        expect(result.type).toBe("template");
        if (
          result.type === "template" &&
          result.payload.template_type === "generic"
        ) {
          expect(result.payload.elements[0].buttons).toHaveLength(1);
          expect(result.payload.elements[0].buttons?.[0].title).toBe("Nested");
        }
      });
    });
  });

  describe("callback data", () => {
    describe("encoding", () => {
      it("encodes actionId only", () => {
        const result = encodeMessengerCallbackData("my_action");
        expect(result).toBe('chat:{"a":"my_action"}');
      });

      it("encodes actionId and value", () => {
        const result = encodeMessengerCallbackData("my_action", "some_value");
        expect(result).toBe('chat:{"a":"my_action","v":"some_value"}');
      });

      it("handles special characters in actionId", () => {
        const result = encodeMessengerCallbackData("action:with:colons");
        expect(result).toBe('chat:{"a":"action:with:colons"}');
      });
    });

    describe("decoding", () => {
      it("decodes encoded callback data with value", () => {
        const encoded = encodeMessengerCallbackData("my_action", "some_value");
        const result = decodeMessengerCallbackData(encoded);
        expect(result.actionId).toBe("my_action");
        expect(result.value).toBe("some_value");
      });

      it("decodes actionId without value", () => {
        const encoded = encodeMessengerCallbackData("my_action");
        const result = decodeMessengerCallbackData(encoded);
        expect(result.actionId).toBe("my_action");
        expect(result.value).toBeUndefined();
      });

      it("handles non-prefixed data as passthrough (legacy support)", () => {
        const result = decodeMessengerCallbackData("raw_payload");
        expect(result.actionId).toBe("raw_payload");
        expect(result.value).toBe("raw_payload");
      });

      it("handles undefined data", () => {
        const result = decodeMessengerCallbackData(undefined);
        expect(result.actionId).toBe("messenger_callback");
        expect(result.value).toBeUndefined();
      });

      it("handles malformed JSON after prefix", () => {
        const result = decodeMessengerCallbackData("chat:not-valid-json");
        expect(result.actionId).toBe("chat:not-valid-json");
        expect(result.value).toBe("chat:not-valid-json");
      });

      it("handles empty string as missing data", () => {
        const result = decodeMessengerCallbackData("");
        expect(result.actionId).toBe("messenger_callback");
        expect(result.value).toBeUndefined();
      });

      it("roundtrips encode/decode", () => {
        const actionId = "test_action";
        const value = "test_value";
        const encoded = encodeMessengerCallbackData(actionId, value);
        const decoded = decodeMessengerCallbackData(encoded);
        expect(decoded.actionId).toBe(actionId);
        expect(decoded.value).toBe(value);
      });
    });

    describe("template integration", () => {
      it("encodes button id and value in postback payload", () => {
        const card: CardElement = {
          type: "card",
          title: "Test",
          children: [
            {
              type: "actions",
              children: [
                {
                  type: "button",
                  id: "action_id",
                  label: "Click",
                  value: "action_value",
                },
              ],
            },
          ],
        };
        const result = cardToMessenger(card);
        if (
          result.type === "template" &&
          result.payload.template_type === "generic"
        ) {
          const button = result.payload.elements[0].buttons?.[0];
          expect(button?.type).toBe("postback");
          expect(button?.payload).toBe(
            encodeMessengerCallbackData("action_id", "action_value")
          );
        }
      });

      it("encodes button id without value when value is undefined", () => {
        const card: CardElement = {
          type: "card",
          title: "Test",
          children: [
            {
              type: "actions",
              children: [{ type: "button", id: "just_id", label: "Click" }],
            },
          ],
        };
        const result = cardToMessenger(card);
        if (
          result.type === "template" &&
          result.payload.template_type === "generic"
        ) {
          const button = result.payload.elements[0].buttons?.[0];
          expect(button?.payload).toBe(encodeMessengerCallbackData("just_id"));
        }
      });
    });
  });
});
