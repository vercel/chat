/**
 * Tests for the JSX runtime - custom JSX support for chat cards.
 */

import { describe, expect, it } from "vitest";
import {
  Actions,
  Button,
  Card,
  CardLink,
  Divider,
  Field,
  Fields,
  Image,
  LinkButton,
  Section,
  Text,
} from "./cards";
import {
  Fragment,
  isJSX,
  jsx,
  jsxs,
  toCardElement,
  toModalElement,
} from "./jsx-runtime";
import { Modal, RadioSelect, Select, SelectOption, TextInput } from "./modals";

// ============================================================================
// jsx() and jsxs() Factory Tests
// ============================================================================

describe("jsx factory", () => {
  it("creates a JSX element with the correct structure", () => {
    const element = jsx(Card, { title: "Test" });
    expect(element.$$typeof).toBe(Symbol.for("chat.jsx.element"));
    expect(element.type).toBe(Card);
    expect(element.props).toEqual({ title: "Test" });
    expect(element.children).toEqual([]);
  });

  it("extracts children from props", () => {
    const element = jsx(Text, { children: "Hello" });
    expect(element.props).not.toHaveProperty("children");
    expect(element.children).toEqual(["Hello"]);
  });

  it("handles undefined children", () => {
    const element = jsx(Divider, {});
    expect(element.children).toEqual([]);
  });

  it("creates a CardLink JSX element", () => {
    const element = jsx(CardLink, {
      url: "https://example.com",
      label: "Example",
    });
    expect(element.$$typeof).toBe(Symbol.for("chat.jsx.element"));
    expect(element.type).toBe(CardLink);
    expect(element.props).toEqual({
      url: "https://example.com",
      label: "Example",
    });
  });
});

describe("jsxs factory (multiple children)", () => {
  it("creates element with array children", () => {
    const child1 = jsx(Text, { children: "One" });
    const child2 = jsx(Text, { children: "Two" });
    const element = jsxs(Card, { title: "Parent", children: [child1, child2] });
    expect(element.children).toHaveLength(2);
  });

  it("handles single child (wraps in array)", () => {
    const child = jsx(Text, { children: "Single" });
    const element = jsxs(Card, { children: child });
    expect(element.children).toHaveLength(1);
  });

  it("handles null children", () => {
    const element = jsxs(Card, { children: null });
    expect(element.children).toEqual([]);
  });
});

// ============================================================================
// toCardElement() Tests
// ============================================================================

describe("toCardElement", () => {
  it("converts a Card JSX element to CardElement", () => {
    const jsxElement = jsx(Card, { title: "Test Card" });
    const card = toCardElement(jsxElement);

    expect(card).not.toBeNull();
    expect(card?.type).toBe("card");
    expect(card?.title).toBe("Test Card");
  });

  it("handles Card with subtitle and imageUrl", () => {
    const jsxElement = jsx(Card, {
      title: "Title",
      subtitle: "Subtitle",
      imageUrl: "https://example.com/image.png",
    });
    const card = toCardElement(jsxElement);

    expect(card?.title).toBe("Title");
    expect(card?.subtitle).toBe("Subtitle");
    expect(card?.imageUrl).toBe("https://example.com/image.png");
  });

  it("converts nested Text children", () => {
    const textChild = jsx(Text, { children: "Hello" });
    const cardElement = jsxs(Card, { title: "Card", children: [textChild] });
    const card = toCardElement(cardElement);

    expect(card?.children).toHaveLength(1);
    expect(card?.children[0].type).toBe("text");
    expect((card?.children[0] as { content: string }).content).toBe("Hello");
  });

  it("converts Button elements", () => {
    const button = jsx(Button, {
      id: "btn1",
      label: "Click Me",
      style: "primary",
    });
    const actions = jsxs(Actions, { children: [button] });
    const cardElement = jsxs(Card, { children: [actions] });
    const card = toCardElement(cardElement);

    expect(card?.children).toHaveLength(1);
    const actionsEl = card?.children[0];
    expect(actionsEl?.type).toBe("actions");
    if (actionsEl?.type === "actions") {
      expect(actionsEl.children).toHaveLength(1);
      const btn = actionsEl.children[0];
      if (btn.type === "button") {
        expect(btn.id).toBe("btn1");
        expect(btn.label).toBe("Click Me");
        expect(btn.style).toBe("primary");
      }
    }
  });

  it("converts Button with children as label", () => {
    const button = jsx(Button, { id: "btn", children: "Label from children" });
    const actions = jsxs(Actions, { children: [button] });
    const cardElement = jsxs(Card, { children: [actions] });
    const card = toCardElement(cardElement);

    if (card?.children[0]?.type === "actions") {
      const btn = card.children[0].children[0];
      if (btn.type === "button") {
        expect(btn.label).toBe("Label from children");
      }
    }
  });

  it("converts LinkButton elements", () => {
    const linkButton = jsx(LinkButton, {
      url: "https://example.com",
      label: "Visit Site",
      style: "primary",
    });
    const actions = jsxs(Actions, { children: [linkButton] });
    const cardElement = jsxs(Card, { children: [actions] });
    const card = toCardElement(cardElement);

    expect(card?.children).toHaveLength(1);
    const actionsEl = card?.children[0];
    expect(actionsEl?.type).toBe("actions");
    if (actionsEl?.type === "actions") {
      expect(actionsEl.children).toHaveLength(1);
      expect(actionsEl.children[0].type).toBe("link-button");
      if (actionsEl.children[0].type === "link-button") {
        expect(actionsEl.children[0].url).toBe("https://example.com");
        expect(actionsEl.children[0].label).toBe("Visit Site");
        expect(actionsEl.children[0].style).toBe("primary");
      }
    }
  });

  it("converts LinkButton with children as label", () => {
    const linkButton = jsx(LinkButton, {
      url: "https://example.com",
      children: "Label from children",
    });
    const actions = jsxs(Actions, { children: [linkButton] });
    const cardElement = jsxs(Card, { children: [actions] });
    const card = toCardElement(cardElement);

    if (card?.children[0]?.type === "actions") {
      expect(card.children[0].children[0].label).toBe("Label from children");
    }
  });

  it("converts Image elements", () => {
    const image = jsx(Image, {
      url: "https://example.com/img.png",
      alt: "Description",
    });
    const cardElement = jsxs(Card, { children: [image] });
    const card = toCardElement(cardElement);

    expect(card?.children).toHaveLength(1);
    expect(card?.children[0].type).toBe("image");
    if (card?.children[0].type === "image") {
      expect(card.children[0].url).toBe("https://example.com/img.png");
      expect(card.children[0].alt).toBe("Description");
    }
  });

  it("converts Divider elements", () => {
    const divider = jsx(Divider, {});
    const cardElement = jsxs(Card, { children: [divider] });
    const card = toCardElement(cardElement);

    expect(card?.children).toHaveLength(1);
    expect(card?.children[0].type).toBe("divider");
  });

  it("converts CardLink elements", () => {
    const link = jsx(CardLink, {
      url: "https://example.com",
      label: "Visit",
    });
    const cardElement = jsxs(Card, { children: [link] });
    const card = toCardElement(cardElement);

    expect(card?.children).toHaveLength(1);
    expect(card?.children[0].type).toBe("link");
    if (card?.children[0].type === "link") {
      expect(card.children[0].url).toBe("https://example.com");
      expect(card.children[0].label).toBe("Visit");
    }
  });

  it("converts CardLink with children as label", () => {
    const link = jsx(CardLink, {
      url: "https://example.com",
      children: "Label from children",
    });
    const cardElement = jsxs(Card, { children: [link] });
    const card = toCardElement(cardElement);

    if (card?.children[0]?.type === "link") {
      expect(card.children[0].label).toBe("Label from children");
    }
  });

  it("converts Section elements", () => {
    const textChild = jsx(Text, { children: "Section content" });
    const section = jsxs(Section, { children: [textChild] });
    const cardElement = jsxs(Card, { children: [section] });
    const card = toCardElement(cardElement);

    expect(card?.children).toHaveLength(1);
    expect(card?.children[0].type).toBe("section");
    if (card?.children[0].type === "section") {
      expect(card.children[0].children).toHaveLength(1);
    }
  });

  it("converts Field and Fields elements", () => {
    const field1 = jsx(Field, { label: "Name", value: "John" });
    const field2 = jsx(Field, { label: "Email", value: "john@example.com" });
    const fields = jsxs(Fields, { children: [field1, field2] });
    const cardElement = jsxs(Card, { children: [fields] });
    const card = toCardElement(cardElement);

    expect(card?.children).toHaveLength(1);
    expect(card?.children[0].type).toBe("fields");
    if (card?.children[0].type === "fields") {
      expect(card.children[0].children).toHaveLength(2);
      expect(card.children[0].children[0].label).toBe("Name");
      expect(card.children[0].children[0].value).toBe("John");
    }
  });

  it("converts Text with style", () => {
    const textChild = jsx(Text, { style: "bold", children: "Bold text" });
    const cardElement = jsxs(Card, { children: [textChild] });
    const card = toCardElement(cardElement);

    expect(card?.children[0].type).toBe("text");
    if (card?.children[0].type === "text") {
      expect(card.children[0].style).toBe("bold");
      expect(card.children[0].content).toBe("Bold text");
    }
  });

  it("returns existing CardElement unchanged", () => {
    const card = Card({ title: "Already a card" });
    const result = toCardElement(card);

    expect(result).toBe(card);
  });

  it("returns null for non-card JSX elements", () => {
    const textElement = jsx(Text, { children: "Not a card" });
    const result = toCardElement(textElement);

    expect(result).toBeNull();
  });

  it("returns null for non-JSX values", () => {
    expect(toCardElement(null)).toBeNull();
    expect(toCardElement(undefined)).toBeNull();
    expect(toCardElement("string")).toBeNull();
    expect(toCardElement(123)).toBeNull();
    expect(toCardElement({})).toBeNull();
  });

  it("handles complex nested structure", () => {
    const card = jsxs(Card, {
      title: "Complex Card",
      subtitle: "With many elements",
      children: [
        jsx(Text, { children: "Introduction" }),
        jsx(Divider, {}),
        jsxs(Section, {
          children: [
            jsx(Text, { style: "bold", children: "Section Title" }),
            jsx(Image, { url: "https://example.com/img.png" }),
          ],
        }),
        jsxs(Fields, {
          children: [
            jsx(Field, { label: "Status", value: "Active" }),
            jsx(Field, { label: "Type", value: "Premium" }),
          ],
        }),
        jsxs(Actions, {
          children: [
            jsx(Button, { id: "save", style: "primary", children: "Save" }),
            jsx(Button, { id: "cancel", children: "Cancel" }),
          ],
        }),
      ],
    });

    const result = toCardElement(card);

    expect(result).not.toBeNull();
    expect(result?.title).toBe("Complex Card");
    expect(result?.subtitle).toBe("With many elements");
    expect(result?.children).toHaveLength(5);

    // Verify each child type
    expect(result?.children[0].type).toBe("text");
    expect(result?.children[1].type).toBe("divider");
    expect(result?.children[2].type).toBe("section");
    expect(result?.children[3].type).toBe("fields");
    expect(result?.children[4].type).toBe("actions");
  });
});

// ============================================================================
// Fragment Tests
// ============================================================================

describe("Fragment", () => {
  it("flattens children into array", () => {
    const child1 = jsx(Text, { children: "One" });
    const child2 = jsx(Text, { children: "Two" });
    const result = Fragment({ children: [child1, child2] });

    expect(result).toHaveLength(2);
  });

  it("handles single child", () => {
    const child = jsx(Text, { children: "Single" });
    const result = Fragment({ children: child });

    expect(result).toHaveLength(1);
  });

  it("handles undefined children", () => {
    const result = Fragment({});
    expect(result).toEqual([]);
  });

  it("handles null children", () => {
    const result = Fragment({ children: null });
    expect(result).toEqual([]);
  });
});

// ============================================================================
// isJSX Tests
// ============================================================================

describe("isJSX", () => {
  it("returns true for our JSX elements", () => {
    const element = jsx(Card, { title: "Test" });
    expect(isJSX(element)).toBe(true);
  });

  it("returns false for plain objects", () => {
    expect(isJSX({})).toBe(false);
    expect(isJSX({ type: "card" })).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isJSX(null)).toBe(false);
    expect(isJSX(undefined)).toBe(false);
    expect(isJSX("string")).toBe(false);
    expect(isJSX(123)).toBe(false);
    expect(isJSX(true)).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isJSX([])).toBe(false);
    expect(isJSX([jsx(Card, {})])).toBe(false);
  });

  it("returns true for objects with react.element symbol", () => {
    const reactLikeElement = {
      $$typeof: Symbol.for("react.element"),
      type: Card,
      props: {},
    };
    expect(isJSX(reactLikeElement)).toBe(true);
  });

  it("returns true for react.transitional.element", () => {
    const transitionalElement = {
      $$typeof: Symbol.for("react.transitional.element"),
      type: Card,
      props: {},
    };
    expect(isJSX(transitionalElement)).toBe(true);
  });
});

// ============================================================================
// Type Guard Error Tests
// ============================================================================

describe("type guard errors", () => {
  it("throws for Button without id", () => {
    // @ts-expect-error Testing runtime error for missing id
    const button = jsx(Button, { label: "No ID" });
    const card = jsxs(Card, {
      children: [jsxs(Actions, { children: [button] })],
    });

    expect(() => toCardElement(card)).toThrow("Button requires an 'id' prop");
  });

  it("throws for Image without url", () => {
    // @ts-expect-error Testing runtime error for missing url
    const image = jsx(Image, { alt: "No URL" });
    const card = jsxs(Card, { children: [image] });

    expect(() => toCardElement(card)).toThrow("Image requires a 'url' prop");
  });

  it("throws for Field without label or value", () => {
    // @ts-expect-error Testing runtime error for missing props
    const field = jsx(Field, { label: "Name" });
    const card = jsxs(Card, {
      children: [jsxs(Fields, { children: [field] })],
    });

    expect(() => toCardElement(card)).toThrow(
      "Field requires 'label' and 'value' props"
    );
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("edge cases", () => {
  it("handles empty Card", () => {
    const card = jsx(Card, {});
    const result = toCardElement(card);

    expect(result).not.toBeNull();
    expect(result?.title).toBeUndefined();
    expect(result?.children).toEqual([]);
  });

  it("handles Text with number children", () => {
    const text = jsx(Text, { children: 42 });
    const card = jsxs(Card, { children: [text] });
    const result = toCardElement(card);

    if (result?.children[0]?.type === "text") {
      expect(result.children[0].content).toBe("42");
    }
  });

  it("handles deeply nested Sections", () => {
    const innerText = jsx(Text, { children: "Deep" });
    const innerSection = jsxs(Section, { children: [innerText] });
    const outerSection = jsxs(Section, { children: [innerSection] });
    const card = jsxs(Card, { children: [outerSection] });
    const result = toCardElement(card);

    expect(result?.children[0].type).toBe("section");
    if (result?.children[0].type === "section") {
      expect(result.children[0].children[0].type).toBe("section");
    }
  });

  it("handles Button with value prop", () => {
    const button = jsx(Button, {
      id: "btn",
      label: "Click",
      value: "custom-value",
    });
    const actions = jsxs(Actions, { children: [button] });
    const card = jsxs(Card, { children: [actions] });
    const result = toCardElement(card);

    if (result?.children[0].type === "actions") {
      const btn = result.children[0].children[0];
      if (btn.type === "button") {
        expect(btn.value).toBe("custom-value");
      }
    }
  });

  it("handles mixed children types", () => {
    // Mix of JSX elements and already-resolved elements
    const jsxText = jsx(Text, { children: "JSX Text" });
    const resolvedText = Text("Resolved Text");
    const card = jsxs(Card, { children: [jsxText, resolvedText] });
    const result = toCardElement(card);

    expect(result?.children).toHaveLength(2);
    expect(result?.children[0].type).toBe("text");
    expect(result?.children[1].type).toBe("text");
  });
});

// ============================================================================
// toModalElement() Tests
// ============================================================================

describe("toModalElement", () => {
  it("converts a Modal JSX element to ModalElement", () => {
    const jsxElement = jsx(Modal, {
      callbackId: "test_modal",
      title: "Test Modal",
    });
    const modal = toModalElement(jsxElement);

    expect(modal).not.toBeNull();
    expect(modal?.type).toBe("modal");
    expect(modal?.callbackId).toBe("test_modal");
    expect(modal?.title).toBe("Test Modal");
  });

  it("converts a Modal with children to ModalElement", () => {
    const textInput = jsx(TextInput, { id: "name", label: "Name" });
    const jsxElement = jsxs(Modal, {
      callbackId: "form_modal",
      title: "Form",
      children: [textInput],
    });
    const modal = toModalElement(jsxElement);

    expect(modal).not.toBeNull();
    expect(modal?.type).toBe("modal");
    expect(modal?.children).toHaveLength(1);
    expect(modal?.children[0].type).toBe("text_input");
  });

  it("converts a Modal with Select and options", () => {
    const option1 = jsx(SelectOption, { label: "Option 1", value: "1" });
    const option2 = jsx(SelectOption, { label: "Option 2", value: "2" });
    const select = jsxs(Select, {
      id: "choice",
      label: "Choose",
      children: [option1, option2],
    });
    const jsxElement = jsxs(Modal, {
      callbackId: "select_modal",
      title: "Select Form",
      children: [select],
    });
    const modal = toModalElement(jsxElement);

    expect(modal).not.toBeNull();
    expect(modal?.children).toHaveLength(1);
    expect(modal?.children[0].type).toBe("select");
    const selectChild = modal?.children[0] as { options: unknown[] };
    expect(selectChild.options).toHaveLength(2);
  });

  it("returns existing ModalElement unchanged", () => {
    const modal = Modal({ callbackId: "existing", title: "Existing" });
    const result = toModalElement(modal);

    expect(result).toBe(modal);
  });

  it("returns null for non-Modal JSX elements", () => {
    const cardElement = jsx(Card, { title: "Test Card" });
    expect(toModalElement(cardElement)).toBeNull();
  });

  it("returns null for invalid inputs", () => {
    expect(toModalElement(null)).toBeNull();
    expect(toModalElement(undefined)).toBeNull();
    expect(toModalElement("string")).toBeNull();
    expect(toModalElement(123)).toBeNull();
    expect(toModalElement({})).toBeNull();
  });

  it("preserves optional modal properties", () => {
    const jsxElement = jsx(Modal, {
      callbackId: "full_modal",
      title: "Full Modal",
      submitLabel: "Send",
      closeLabel: "Cancel",
      notifyOnClose: true,
    });
    const modal = toModalElement(jsxElement);

    expect(modal?.submitLabel).toBe("Send");
    expect(modal?.closeLabel).toBe("Cancel");
    expect(modal?.notifyOnClose).toBe(true);
  });

  it("preserves privateMetadata from JSX props", () => {
    const metadata = JSON.stringify({ chatId: "abc", scope: "team" });
    const jsxElement = jsx(Modal, {
      callbackId: "meta_modal",
      title: "With Metadata",
      privateMetadata: metadata,
    });
    const modal = toModalElement(jsxElement);

    expect(modal?.privateMetadata).toBe(metadata);
    const parsed = JSON.parse(modal?.privateMetadata as string);
    expect(parsed.chatId).toBe("abc");
    expect(parsed.scope).toBe("team");
  });

  it("converts a Modal with RadioSelect and options", () => {
    const option1 = jsx(SelectOption, { label: "Yes", value: "yes" });
    const option2 = jsx(SelectOption, { label: "No", value: "no" });
    const radioSelect = jsxs(RadioSelect, {
      id: "confirm",
      label: "Confirm",
      children: [option1, option2],
    });
    const jsxElement = jsxs(Modal, {
      callbackId: "radio_modal",
      title: "Radio Form",
      children: [radioSelect],
    });
    const modal = toModalElement(jsxElement);

    expect(modal).not.toBeNull();
    expect(modal?.children).toHaveLength(1);
    expect(modal?.children[0].type).toBe("radio_select");
    const radioChild = modal?.children[0] as { options: unknown[] };
    expect(radioChild.options).toHaveLength(2);
  });

  it("converts SelectOption with description in Modal", () => {
    const option1 = jsx(SelectOption, {
      label: "Basic",
      value: "basic",
      description: "For individuals",
    });
    const option2 = jsx(SelectOption, {
      label: "Pro",
      value: "pro",
      description: "For teams",
    });
    const select = jsxs(Select, {
      id: "plan",
      label: "Plan",
      children: [option1, option2],
    });
    const jsxElement = jsxs(Modal, {
      callbackId: "desc_modal",
      title: "Plan Selection",
      children: [select],
    });
    const modal = toModalElement(jsxElement);

    expect(modal).not.toBeNull();
    const selectChild = modal?.children[0] as {
      options: Array<{ label: string; value: string; description?: string }>;
    };
    expect(selectChild.options[0].description).toBe("For individuals");
    expect(selectChild.options[1].description).toBe("For teams");
  });

  it("throws when Select has no SelectOption children", () => {
    const select = jsxs(Select, {
      id: "empty",
      label: "Empty Select",
      children: [],
    });
    const modal = jsxs(Modal, {
      callbackId: "test",
      title: "Test",
      children: [select],
    });
    expect(() => toModalElement(modal)).toThrow(
      "Select requires at least one option"
    );
  });

  it("throws when RadioSelect has no SelectOption children", () => {
    const radioSelect = jsxs(RadioSelect, {
      id: "empty",
      label: "Empty RadioSelect",
      children: [],
    });
    const modal = jsxs(Modal, {
      callbackId: "test",
      title: "Test",
      children: [radioSelect],
    });
    expect(() => toModalElement(modal)).toThrow(
      "RadioSelect requires at least one option"
    );
  });
});

// ============================================================================
// JSX Select and RadioSelect in Cards Tests
// ============================================================================

describe("toCardElement with Select elements", () => {
  it("converts Select in Actions", () => {
    const option1 = jsx(SelectOption, { label: "High", value: "high" });
    const option2 = jsx(SelectOption, { label: "Low", value: "low" });
    const select = jsxs(Select, {
      id: "priority",
      label: "Priority",
      children: [option1, option2],
    });
    const actions = jsxs(Actions, { children: [select] });
    const cardElement = jsxs(Card, { children: [actions] });
    const card = toCardElement(cardElement);

    expect(card?.children).toHaveLength(1);
    const actionsEl = card?.children[0];
    expect(actionsEl?.type).toBe("actions");
    if (actionsEl?.type === "actions") {
      expect(actionsEl.children).toHaveLength(1);
      const selectEl = actionsEl.children[0];
      expect(selectEl.type).toBe("select");
      if (selectEl.type === "select") {
        expect(selectEl.id).toBe("priority");
        expect(selectEl.options).toHaveLength(2);
      }
    }
  });

  it("converts RadioSelect in Actions", () => {
    const option1 = jsx(SelectOption, { label: "Yes", value: "yes" });
    const option2 = jsx(SelectOption, { label: "No", value: "no" });
    const radioSelect = jsxs(RadioSelect, {
      id: "confirm",
      label: "Confirm",
      children: [option1, option2],
    });
    const actions = jsxs(Actions, { children: [radioSelect] });
    const cardElement = jsxs(Card, { children: [actions] });
    const card = toCardElement(cardElement);

    expect(card?.children).toHaveLength(1);
    const actionsEl = card?.children[0];
    expect(actionsEl?.type).toBe("actions");
    if (actionsEl?.type === "actions") {
      expect(actionsEl.children).toHaveLength(1);
      const radioEl = actionsEl.children[0];
      expect(radioEl.type).toBe("radio_select");
      if (radioEl.type === "radio_select") {
        expect(radioEl.id).toBe("confirm");
        expect(radioEl.options).toHaveLength(2);
      }
    }
  });

  it("converts SelectOption with description in Card Actions", () => {
    const option1 = jsx(SelectOption, {
      label: "Basic",
      value: "basic",
      description: "For individuals",
    });
    const option2 = jsx(SelectOption, {
      label: "Pro",
      value: "pro",
      description: "For teams",
    });
    const select = jsxs(Select, {
      id: "plan",
      label: "Plan",
      children: [option1, option2],
    });
    const actions = jsxs(Actions, { children: [select] });
    const cardElement = jsxs(Card, { children: [actions] });
    const card = toCardElement(cardElement);

    const actionsEl = card?.children[0];
    if (actionsEl?.type === "actions") {
      const selectEl = actionsEl.children[0];
      if (selectEl.type === "select") {
        expect(selectEl.options[0].description).toBe("For individuals");
        expect(selectEl.options[1].description).toBe("For teams");
      }
    }
  });

  it("converts mixed Buttons, Select, and RadioSelect in Actions", () => {
    const button = jsx(Button, { id: "submit", label: "Submit" });
    const option = jsx(SelectOption, { label: "Option", value: "opt" });
    const select = jsxs(Select, {
      id: "dropdown",
      label: "Dropdown",
      children: [option],
    });
    const radioSelect = jsxs(RadioSelect, {
      id: "choice",
      label: "Choice",
      children: [option],
    });
    const actions = jsxs(Actions, { children: [button, select, radioSelect] });
    const cardElement = jsxs(Card, { children: [actions] });
    const card = toCardElement(cardElement);

    const actionsEl = card?.children[0];
    if (actionsEl?.type === "actions") {
      expect(actionsEl.children).toHaveLength(3);
      expect(actionsEl.children[0].type).toBe("button");
      expect(actionsEl.children[1].type).toBe("select");
      expect(actionsEl.children[2].type).toBe("radio_select");
    }
  });

  it("throws when Select in Actions has no options", () => {
    const select = jsxs(Select, {
      id: "empty",
      label: "Empty",
      children: [],
    });
    const actions = jsxs(Actions, { children: [select] });
    const card = jsxs(Card, { children: [actions] });
    expect(() => toCardElement(card)).toThrow(
      "Select requires at least one option"
    );
  });

  it("throws when RadioSelect in Actions has no options", () => {
    const radioSelect = jsxs(RadioSelect, {
      id: "empty",
      label: "Empty",
      children: [],
    });
    const actions = jsxs(Actions, { children: [radioSelect] });
    const card = jsxs(Card, { children: [actions] });
    expect(() => toCardElement(card)).toThrow(
      "RadioSelect requires at least one option"
    );
  });
});
