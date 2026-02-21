/**
 * Tests for React JSX mode - using fromReactElement to convert React elements to card elements.
 *
 * This mode allows using React's JSX syntax with card components:
 * ```tsx
 * import { Card, Text, fromReactElement } from "chat";
 *
 * const element = <Card title="Hello"><Text>World</Text></Card>;
 * const card = fromReactElement(element);
 * await thread.post(card);
 * ```
 */
import { describe, expect, it } from "vitest";
import {
  Actions,
  Button,
  Card,
  Divider,
  Field,
  Fields,
  fromReactElement,
  Image,
  Section,
  Text,
} from "./cards";

// Helper to create mock React elements
function createReactElement(
  type: unknown,
  props: Record<string, unknown> = {}
) {
  return {
    $$typeof: Symbol.for("react.element"),
    type,
    props,
  };
}

describe("fromReactElement - React JSX mode", () => {
  describe("error handling", () => {
    it("throws error for HTML elements like div", () => {
      const divElement = createReactElement("div", { children: "Hello" });
      expect(() => fromReactElement(divElement)).toThrow(
        "HTML element <div> is not supported in card elements."
      );
    });

    it("throws error for anchor elements", () => {
      const anchorElement = createReactElement("a", {
        href: "https://example.com",
        children: "Link",
      });
      expect(() => fromReactElement(anchorElement)).toThrow(
        "HTML element <a> is not supported in card elements."
      );
    });

    it("throws error for span elements", () => {
      const spanElement = createReactElement("span", { children: "Text" });
      expect(() => fromReactElement(spanElement)).toThrow(
        "HTML element <span> is not supported in card elements."
      );
    });

    it("returns null for non-React elements", () => {
      expect(fromReactElement("string")).toBe(null);
      expect(fromReactElement(123)).toBe(null);
      expect(fromReactElement(null)).toBe(null);
      expect(fromReactElement(undefined)).toBe(null);
    });

    it("returns card elements unchanged", () => {
      const card = Card({ title: "Test" });
      expect(fromReactElement(card)).toBe(card);
    });
  });

  describe("Card conversion", () => {
    it("converts simple Card element", () => {
      const reactCard = createReactElement(Card, {
        title: "Test Card",
        subtitle: "Subtitle",
      });

      const result = fromReactElement(reactCard);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("card");
      if (result?.type === "card") {
        expect(result.title).toBe("Test Card");
        expect(result.subtitle).toBe("Subtitle");
        expect(result.children).toEqual([]);
      }
    });

    it("converts Card with Text child", () => {
      const reactCard = createReactElement(Card, {
        title: "Test Card",
        children: createReactElement(Text, { children: "Hello world" }),
      });

      const result = fromReactElement(reactCard);
      expect(result?.type).toBe("card");
      if (result?.type === "card") {
        expect(result.children).toHaveLength(1);
        expect(result.children[0].type).toBe("text");
        if (result.children[0].type === "text") {
          expect(result.children[0].content).toBe("Hello world");
        }
      }
    });

    it("converts Card with imageUrl", () => {
      const reactCard = createReactElement(Card, {
        title: "Test",
        imageUrl: "https://example.com/image.png",
      });

      const result = fromReactElement(reactCard);
      if (result?.type === "card") {
        expect(result.imageUrl).toBe("https://example.com/image.png");
      }
    });
  });

  describe("Text conversion", () => {
    it("converts Text with string content", () => {
      const reactText = createReactElement(Text, { children: "Hello" });
      const result = fromReactElement(reactText);

      expect(result?.type).toBe("text");
      if (result?.type === "text") {
        expect(result.content).toBe("Hello");
      }
    });

    it("converts Text with style", () => {
      const reactText = createReactElement(Text, {
        children: "Bold text",
        style: "bold",
      });
      const result = fromReactElement(reactText);

      if (result?.type === "text") {
        expect(result.content).toBe("Bold text");
        expect(result.style).toBe("bold");
      }
    });
  });

  describe("Actions and Button conversion", () => {
    it("converts Actions with Button children", () => {
      const reactActions = createReactElement(Actions, {
        children: [
          createReactElement(Button, {
            id: "approve",
            style: "primary",
            children: "Approve",
          }),
          createReactElement(Button, {
            id: "reject",
            style: "danger",
            children: "Reject",
          }),
        ],
      });

      const result = fromReactElement(reactActions);
      expect(result?.type).toBe("actions");
      if (result?.type === "actions") {
        expect(result.children).toHaveLength(2);
        const btn0 = result.children[0];
        const btn1 = result.children[1];
        if (btn0.type === "button" && btn1.type === "button") {
          expect(btn0.id).toBe("approve");
          expect(btn0.label).toBe("Approve");
          expect(btn0.style).toBe("primary");
          expect(btn1.id).toBe("reject");
          expect(btn1.style).toBe("danger");
        }
      }
    });

    it("converts Button with value", () => {
      const reactCard = createReactElement(Card, {
        children: createReactElement(Actions, {
          children: createReactElement(Button, {
            id: "delete",
            value: "item-123",
            children: "Delete",
          }),
        }),
      });

      const result = fromReactElement(reactCard);
      if (result?.type === "card" && result.children[0]?.type === "actions") {
        const btn = result.children[0].children[0];
        if (btn.type === "button") {
          expect(btn.value).toBe("item-123");
        }
      }
    });
  });

  describe("Fields and Field conversion", () => {
    it("converts Fields with Field children", () => {
      const reactFields = createReactElement(Fields, {
        children: [
          createReactElement(Field, { label: "Name", value: "John Doe" }),
          createReactElement(Field, {
            label: "Email",
            value: "john@example.com",
          }),
        ],
      });

      const result = fromReactElement(reactFields);
      expect(result?.type).toBe("fields");
      if (result?.type === "fields") {
        expect(result.children).toHaveLength(2);
        expect(result.children[0].label).toBe("Name");
        expect(result.children[0].value).toBe("John Doe");
        expect(result.children[1].label).toBe("Email");
      }
    });
  });

  describe("Section conversion", () => {
    it("converts Section with children", () => {
      const reactSection = createReactElement(Section, {
        children: [
          createReactElement(Text, { children: "Section content" }),
          createReactElement(Divider, {}),
        ],
      });

      const result = fromReactElement(reactSection);
      expect(result?.type).toBe("section");
      if (result?.type === "section") {
        expect(result.children).toHaveLength(2);
        expect(result.children[0].type).toBe("text");
        expect(result.children[1].type).toBe("divider");
      }
    });
  });

  describe("Image conversion", () => {
    it("converts Image element", () => {
      const reactImage = createReactElement(Image, {
        url: "https://example.com/img.png",
        alt: "A description",
      });

      const result = fromReactElement(reactImage);
      expect(result?.type).toBe("image");
      if (result?.type === "image") {
        expect(result.url).toBe("https://example.com/img.png");
        expect(result.alt).toBe("A description");
      }
    });
  });

  describe("Divider conversion", () => {
    it("converts Divider element", () => {
      const reactDivider = createReactElement(Divider, {});
      const result = fromReactElement(reactDivider);
      expect(result?.type).toBe("divider");
    });
  });

  describe("complex nested structures", () => {
    it("converts full card with all element types", () => {
      const reactCard = createReactElement(Card, {
        title: "Order #123",
        subtitle: "Processing",
        children: [
          createReactElement(Text, { children: "Your order is ready" }),
          createReactElement(Divider, {}),
          createReactElement(Fields, {
            children: [
              createReactElement(Field, { label: "Total", value: "$50.00" }),
              createReactElement(Field, { label: "Status", value: "Ready" }),
            ],
          }),
          createReactElement(Section, {
            children: createReactElement(Image, {
              url: "https://example.com/product.png",
            }),
          }),
          createReactElement(Divider, {}),
          createReactElement(Actions, {
            children: [
              createReactElement(Button, {
                id: "pickup",
                style: "primary",
                children: "Schedule Pickup",
              }),
              createReactElement(Button, {
                id: "cancel",
                style: "danger",
                value: "order-123",
                children: "Cancel Order",
              }),
            ],
          }),
        ],
      });

      const result = fromReactElement(reactCard);
      expect(result?.type).toBe("card");
      if (result?.type === "card") {
        expect(result.title).toBe("Order #123");
        expect(result.subtitle).toBe("Processing");
        expect(result.children).toHaveLength(6);
        expect(result.children[0].type).toBe("text");
        expect(result.children[1].type).toBe("divider");
        expect(result.children[2].type).toBe("fields");
        expect(result.children[3].type).toBe("section");
        expect(result.children[4].type).toBe("divider");
        expect(result.children[5].type).toBe("actions");
      }
    });
  });
});
