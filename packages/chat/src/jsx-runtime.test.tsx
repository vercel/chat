// @ts-nocheck - Uses vitest's custom JSX runtime config, not TypeScript's
/**
 * Tests for the custom chat-sdk JSX runtime using actual JSX syntax.
 *
 * This file uses the chat-sdk JSX runtime configured in vitest.config.ts.
 */
import { describe, expect, it } from "vitest";
import {
  Actions,
  Button,
  Card,
  Divider,
  Field,
  Fields,
  Image,
  LinkButton,
  Section,
  Text,
} from "./cards";
import { isJSX, toCardElement } from "./jsx-runtime";

describe("chat-sdk JSX runtime with actual JSX syntax", () => {
  describe("simple elements", () => {
    it("creates Card with title", () => {
      const element = <Card title="Test Card" />;
      const result = toCardElement(element);

      expect(result?.type).toBe("card");
      expect(result?.title).toBe("Test Card");
      expect(result?.children).toEqual([]);
    });

    it("creates Card with subtitle and imageUrl", () => {
      const element = (
        <Card
          imageUrl="https://example.com/img.png"
          subtitle="Processing"
          title="Order"
        />
      );
      const result = toCardElement(element);

      expect(result?.title).toBe("Order");
      expect(result?.subtitle).toBe("Processing");
      expect(result?.imageUrl).toBe("https://example.com/img.png");
    });
  });

  describe("Card with children", () => {
    it("creates Card with Text child", () => {
      const element = (
        <Card title="Hello">
          <Text>World</Text>
        </Card>
      );
      const result = toCardElement(element);

      expect(result?.children).toHaveLength(1);
      expect(result?.children[0].type).toBe("text");
      if (result?.children[0].type === "text") {
        expect(result.children[0].content).toBe("World");
      }
    });

    it("creates Card with multiple Text children", () => {
      const element = (
        <Card title="Multi">
          <Text>Line 1</Text>
          <Text>Line 2</Text>
          <Text style="bold">Bold line</Text>
        </Card>
      );
      const result = toCardElement(element);

      expect(result?.children).toHaveLength(3);
      if (result?.children[2].type === "text") {
        expect(result.children[2].style).toBe("bold");
      }
    });

    it("creates Card with Divider", () => {
      const element = (
        <Card title="With Divider">
          <Text>Above</Text>
          <Divider />
          <Text>Below</Text>
        </Card>
      );
      const result = toCardElement(element);

      expect(result?.children).toHaveLength(3);
      expect(result?.children[1].type).toBe("divider");
    });
  });

  describe("Actions and Buttons", () => {
    it("creates Actions with Buttons", () => {
      const element = (
        <Card title="Confirm">
          <Actions>
            <Button id="ok" style="primary">
              OK
            </Button>
            <Button id="cancel">Cancel</Button>
          </Actions>
        </Card>
      );
      const result = toCardElement(element);

      expect(result?.children).toHaveLength(1);
      expect(result?.children[0].type).toBe("actions");
      if (result?.children[0].type === "actions") {
        expect(result.children[0].children).toHaveLength(2);
        expect(result.children[0].children[0].id).toBe("ok");
        expect(result.children[0].children[0].label).toBe("OK");
        expect(result.children[0].children[0].style).toBe("primary");
        expect(result.children[0].children[1].id).toBe("cancel");
        expect(result.children[0].children[1].label).toBe("Cancel");
      }
    });

    it("creates Button with value", () => {
      const element = (
        <Card>
          <Actions>
            <Button id="delete" style="danger" value="item-123">
              Delete Item
            </Button>
          </Actions>
        </Card>
      );
      const result = toCardElement(element);

      if (result?.children[0].type === "actions") {
        expect(result.children[0].children[0].value).toBe("item-123");
      }
    });

    it("creates LinkButton", () => {
      const element = (
        <Card>
          <Actions>
            <LinkButton style="primary" url="https://example.com">
              Visit Site
            </LinkButton>
          </Actions>
        </Card>
      );
      const result = toCardElement(element);

      expect(result?.children).toHaveLength(1);
      if (result?.children[0].type === "actions") {
        expect(result.children[0].children).toHaveLength(1);
        const linkBtn = result.children[0].children[0];
        expect(linkBtn.type).toBe("link-button");
        if (linkBtn.type === "link-button") {
          expect(linkBtn.url).toBe("https://example.com");
          expect(linkBtn.label).toBe("Visit Site");
          expect(linkBtn.style).toBe("primary");
        }
      }
    });

    it("creates Actions with mixed Button and LinkButton", () => {
      const element = (
        <Card>
          <Actions>
            <Button id="submit" style="primary">
              Submit
            </Button>
            <LinkButton url="https://docs.example.com">View Docs</LinkButton>
          </Actions>
        </Card>
      );
      const result = toCardElement(element);

      if (result?.children[0].type === "actions") {
        expect(result.children[0].children).toHaveLength(2);
        expect(result.children[0].children[0].type).toBe("button");
        expect(result.children[0].children[1].type).toBe("link-button");
      }
    });
  });

  describe("Fields and Field", () => {
    it("creates Fields with Field children", () => {
      const element = (
        <Card title="User Info">
          <Fields>
            <Field label="Name" value="John Doe" />
            <Field label="Email" value="john@example.com" />
          </Fields>
        </Card>
      );
      const result = toCardElement(element);

      expect(result?.children).toHaveLength(1);
      expect(result?.children[0].type).toBe("fields");
      if (result?.children[0].type === "fields") {
        expect(result.children[0].children).toHaveLength(2);
        expect(result.children[0].children[0].label).toBe("Name");
        expect(result.children[0].children[0].value).toBe("John Doe");
      }
    });
  });

  describe("Section", () => {
    it("creates Section with children", () => {
      const element = (
        <Card>
          <Section>
            <Text>Inside section</Text>
            <Image alt="Description" url="https://example.com/img.png" />
          </Section>
        </Card>
      );
      const result = toCardElement(element);

      expect(result?.children[0].type).toBe("section");
      if (result?.children[0].type === "section") {
        expect(result.children[0].children).toHaveLength(2);
        expect(result.children[0].children[0].type).toBe("text");
        expect(result.children[0].children[1].type).toBe("image");
      }
    });
  });

  describe("Image", () => {
    it("creates Image with url and alt", () => {
      const element = (
        <Card>
          <Image alt="A photo" url="https://example.com/photo.jpg" />
        </Card>
      );
      const result = toCardElement(element);

      if (result?.children[0].type === "image") {
        expect(result.children[0].url).toBe("https://example.com/photo.jpg");
        expect(result.children[0].alt).toBe("A photo");
      }
    });
  });

  describe("complex structures", () => {
    it("creates full card with all element types", () => {
      const element = (
        <Card subtitle="Ready for pickup" title="Order #123">
          <Text>Your order is ready!</Text>
          <Divider />
          <Fields>
            <Field label="Total" value="$50.00" />
            <Field label="Items" value="3" />
          </Fields>
          <Divider />
          <Section>
            <Text style="muted">Pickup instructions:</Text>
            <Text>Go to counter #5</Text>
          </Section>
          <Divider />
          <Actions>
            <Button id="pickup" style="primary">
              I'm Here
            </Button>
            <Button id="delay" value="30min">
              Delay 30min
            </Button>
            <Button id="cancel" style="danger">
              Cancel
            </Button>
          </Actions>
        </Card>
      );

      const result = toCardElement(element);
      expect(result?.type).toBe("card");
      expect(result?.title).toBe("Order #123");
      expect(result?.subtitle).toBe("Ready for pickup");
      expect(result?.children).toHaveLength(7);

      // Verify structure
      expect(result?.children[0].type).toBe("text");
      expect(result?.children[1].type).toBe("divider");
      expect(result?.children[2].type).toBe("fields");
      expect(result?.children[3].type).toBe("divider");
      expect(result?.children[4].type).toBe("section");
      expect(result?.children[5].type).toBe("divider");
      expect(result?.children[6].type).toBe("actions");

      // Verify actions
      if (result?.children[6].type === "actions") {
        expect(result.children[6].children).toHaveLength(3);
      }
    });
  });

  describe("isJSX detection", () => {
    it("detects chat-sdk JSX elements", () => {
      const element = <Card title="Test" />;
      expect(isJSX(element)).toBe(true);
    });

    it("returns false for plain objects", () => {
      expect(isJSX({ type: "card", children: [] })).toBe(false);
    });
  });

  describe("toCardElement edge cases", () => {
    it("returns null for non-Card root elements", () => {
      const element = <Text>Hello</Text>;
      const result = toCardElement(element);
      expect(result).toBeNull();
    });

    it("returns CardElement unchanged if already resolved", () => {
      const cardElement = Card({ title: "Test", children: [] });
      const result = toCardElement(cardElement);
      expect(result).toBe(cardElement);
    });
  });
});
