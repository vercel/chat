import { describe, expect, it, vi } from "vitest";
import {
  filterModalChildren,
  fromReactModalElement,
  isModalElement,
  Modal,
  RadioSelect,
  Select,
  SelectOption,
  TextInput,
} from "./modals";

describe("Builder Functions", () => {
  describe("Modal", () => {
    it("should create a modal with required fields", () => {
      const modal = Modal({ callbackId: "cb-1", title: "My Modal" });
      expect(modal.type).toBe("modal");
      expect(modal.callbackId).toBe("cb-1");
      expect(modal.title).toBe("My Modal");
      expect(modal.children).toEqual([]);
    });

    it("should include optional fields", () => {
      const modal = Modal({
        callbackId: "cb-1",
        title: "Test",
        submitLabel: "Submit",
        closeLabel: "Cancel",
        notifyOnClose: true,
        privateMetadata: '{"key":"val"}',
      });
      expect(modal.submitLabel).toBe("Submit");
      expect(modal.closeLabel).toBe("Cancel");
      expect(modal.notifyOnClose).toBe(true);
      expect(modal.privateMetadata).toBe('{"key":"val"}');
    });

    it("should accept children", () => {
      const input = TextInput({ id: "t1", label: "Name" });
      const modal = Modal({
        callbackId: "cb-1",
        title: "Test",
        children: [input],
      });
      expect(modal.children).toHaveLength(1);
      expect(modal.children[0]).toEqual(input);
    });
  });

  describe("TextInput", () => {
    it("should create with required fields", () => {
      const input = TextInput({ id: "t1", label: "Name" });
      expect(input.type).toBe("text_input");
      expect(input.id).toBe("t1");
      expect(input.label).toBe("Name");
    });

    it("should include optional fields", () => {
      const input = TextInput({
        id: "t1",
        label: "Name",
        placeholder: "Enter name",
        initialValue: "John",
        multiline: true,
        optional: true,
        maxLength: 100,
      });
      expect(input.placeholder).toBe("Enter name");
      expect(input.initialValue).toBe("John");
      expect(input.multiline).toBe(true);
      expect(input.optional).toBe(true);
      expect(input.maxLength).toBe(100);
    });
  });

  describe("Select", () => {
    it("should create with options", () => {
      const sel = Select({
        id: "s1",
        label: "Pick one",
        options: [SelectOption({ label: "A", value: "a" })],
      });
      expect(sel.type).toBe("select");
      expect(sel.options).toHaveLength(1);
    });

    it("should throw with empty options", () => {
      expect(() => Select({ id: "s1", label: "Pick", options: [] })).toThrow(
        "Select requires at least one option",
      );
    });

    it("should include optional fields", () => {
      const sel = Select({
        id: "s1",
        label: "Pick",
        placeholder: "Choose",
        options: [SelectOption({ label: "A", value: "a" })],
        initialOption: "a",
        optional: true,
      });
      expect(sel.placeholder).toBe("Choose");
      expect(sel.initialOption).toBe("a");
      expect(sel.optional).toBe(true);
    });
  });

  describe("SelectOption", () => {
    it("should create with label and value", () => {
      const opt = SelectOption({ label: "Option A", value: "a" });
      expect(opt.label).toBe("Option A");
      expect(opt.value).toBe("a");
    });

    it("should include description", () => {
      const opt = SelectOption({
        label: "Option A",
        value: "a",
        description: "First option",
      });
      expect(opt.description).toBe("First option");
    });
  });

  describe("RadioSelect", () => {
    it("should create with options", () => {
      const radio = RadioSelect({
        id: "r1",
        label: "Choose",
        options: [SelectOption({ label: "X", value: "x" })],
      });
      expect(radio.type).toBe("radio_select");
      expect(radio.options).toHaveLength(1);
    });

    it("should throw with empty options", () => {
      expect(() =>
        RadioSelect({ id: "r1", label: "Choose", options: [] }),
      ).toThrow("RadioSelect requires at least one option");
    });
  });
});

describe("Type Guards", () => {
  describe("isModalElement", () => {
    it("should return true for modal elements", () => {
      const modal = Modal({ callbackId: "cb", title: "T" });
      expect(isModalElement(modal)).toBe(true);
    });

    it("should return false for non-modal elements", () => {
      expect(isModalElement(null)).toBe(false);
      expect(isModalElement(undefined)).toBe(false);
      expect(isModalElement("string")).toBe(false);
      expect(isModalElement({ type: "text_input" })).toBe(false);
    });
  });

  describe("filterModalChildren", () => {
    it("should keep valid child types", () => {
      const children = [
        TextInput({ id: "t1", label: "Name" }),
        Select({
          id: "s1",
          label: "Pick",
          options: [SelectOption({ label: "A", value: "a" })],
        }),
      ];
      const result = filterModalChildren(children);
      expect(result).toHaveLength(2);
    });

    it("should filter invalid children and warn", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const children = [
        TextInput({ id: "t1", label: "Name" }),
        { type: "unknown_widget" },
      ];
      const result = filterModalChildren(children);
      expect(result).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalledWith(
        "[chat] Modal contains unsupported child elements that were ignored",
      );
      warnSpy.mockRestore();
    });

    it("should filter non-object items", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = filterModalChildren(["string", null, 42] as unknown[]);
      expect(result).toHaveLength(0);
      warnSpy.mockRestore();
    });
  });
});

describe("JSX Support", () => {
  const REACT_ELEMENT_SYMBOL = Symbol.for("react.element");

  function makeReactElement(type: unknown, props: Record<string, unknown>) {
    return { $$typeof: REACT_ELEMENT_SYMBOL, type, props };
  }

  describe("fromReactModalElement", () => {
    it("should convert a Modal react element", () => {
      const el = makeReactElement(Modal, {
        callbackId: "cb-1",
        title: "Test Modal",
      });
      const result = fromReactModalElement(el);
      expect(result).not.toBeNull();
      expect(isModalElement(result)).toBe(true);
      if (isModalElement(result)) {
        expect(result.callbackId).toBe("cb-1");
        expect(result.title).toBe("Test Modal");
      }
    });

    it("should convert a TextInput react element", () => {
      const el = makeReactElement(TextInput, { id: "t1", label: "Name" });
      const result = fromReactModalElement(el);
      expect(result).not.toBeNull();
      if (result && "type" in result) {
        expect(result.type).toBe("text_input");
      }
    });

    it("should convert a Select react element with children", () => {
      const optEl = makeReactElement(SelectOption, {
        label: "A",
        value: "a",
      });
      const selEl = makeReactElement(Select, {
        id: "s1",
        label: "Pick",
        children: [optEl],
      });
      const result = fromReactModalElement(selEl);
      expect(result).not.toBeNull();
      if (result && "type" in result && result.type === "select") {
        expect(result.options).toHaveLength(1);
      }
    });

    it("should convert a RadioSelect react element", () => {
      const optEl = makeReactElement(SelectOption, {
        label: "X",
        value: "x",
      });
      const radioEl = makeReactElement(RadioSelect, {
        id: "r1",
        label: "Choose",
        children: [optEl],
      });
      const result = fromReactModalElement(radioEl);
      expect(result).not.toBeNull();
      if (result && "type" in result) {
        expect(result.type).toBe("radio_select");
      }
    });

    it("should return null for non-react, non-modal elements", () => {
      expect(fromReactModalElement(null)).toBeNull();
      expect(fromReactModalElement("string")).toBeNull();
      expect(fromReactModalElement(42)).toBeNull();
    });

    it("should pass through plain modal elements", () => {
      const modal = Modal({ callbackId: "cb", title: "T" });
      const result = fromReactModalElement(modal);
      expect(result).toEqual(modal);
    });

    it("should pass through plain modal children", () => {
      const input = TextInput({ id: "t1", label: "Name" });
      const result = fromReactModalElement(input);
      expect(result).toEqual(input);
    });

    it("should handle unknown component by extracting children", () => {
      const childEl = makeReactElement(TextInput, {
        id: "t1",
        label: "Name",
      });
      const unknownComponent = () => {};
      const el = makeReactElement(unknownComponent, {
        children: [childEl],
      });
      const result = fromReactModalElement(el);
      expect(result).not.toBeNull();
    });

    it("should return null for unknown component without children", () => {
      const unknownComponent = () => {};
      const el = makeReactElement(unknownComponent, {});
      const result = fromReactModalElement(el);
      expect(result).toBeNull();
    });
  });
});
