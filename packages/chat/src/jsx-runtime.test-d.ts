import { describe, expectTypeOf, it } from "vitest";
import type {
  ActionsElement,
  ButtonElement,
  CardElement,
  DividerElement,
  FieldElement,
  FieldsElement,
  ImageElement,
  LinkButtonElement,
  LinkElement,
  SectionElement,
  TextElement,
} from "./cards";
import type { CardJSXElement, ChatElement } from "./jsx-runtime";
import type {
  ExternalSelectElement,
  ModalElement,
  RadioSelectElement,
  SelectElement,
  SelectOptionElement,
  TextInputElement,
} from "./modals";

describe("ChatElement type compatibility", () => {
  it("CardJSXElement is assignable to ChatElement", () => {
    expectTypeOf<CardJSXElement>().toMatchTypeOf<ChatElement>();
  });

  it("CardElement is assignable to ChatElement", () => {
    expectTypeOf<CardElement>().toMatchTypeOf<ChatElement>();
  });

  it("TextElement is assignable to ChatElement", () => {
    expectTypeOf<TextElement>().toMatchTypeOf<ChatElement>();
  });

  it("ButtonElement is assignable to ChatElement", () => {
    expectTypeOf<ButtonElement>().toMatchTypeOf<ChatElement>();
  });

  it("LinkButtonElement is assignable to ChatElement", () => {
    expectTypeOf<LinkButtonElement>().toMatchTypeOf<ChatElement>();
  });

  it("LinkElement is assignable to ChatElement", () => {
    expectTypeOf<LinkElement>().toMatchTypeOf<ChatElement>();
  });

  it("ImageElement is assignable to ChatElement", () => {
    expectTypeOf<ImageElement>().toMatchTypeOf<ChatElement>();
  });

  it("DividerElement is assignable to ChatElement", () => {
    expectTypeOf<DividerElement>().toMatchTypeOf<ChatElement>();
  });

  it("ActionsElement is assignable to ChatElement", () => {
    expectTypeOf<ActionsElement>().toMatchTypeOf<ChatElement>();
  });

  it("SectionElement is assignable to ChatElement", () => {
    expectTypeOf<SectionElement>().toMatchTypeOf<ChatElement>();
  });

  it("FieldsElement is assignable to ChatElement", () => {
    expectTypeOf<FieldsElement>().toMatchTypeOf<ChatElement>();
  });

  it("FieldElement is assignable to ChatElement", () => {
    expectTypeOf<FieldElement>().toMatchTypeOf<ChatElement>();
  });

  it("ModalElement is assignable to ChatElement", () => {
    expectTypeOf<ModalElement>().toMatchTypeOf<ChatElement>();
  });

  it("TextInputElement is assignable to ChatElement", () => {
    expectTypeOf<TextInputElement>().toMatchTypeOf<ChatElement>();
  });

  it("SelectElement is assignable to ChatElement", () => {
    expectTypeOf<SelectElement>().toMatchTypeOf<ChatElement>();
  });

  it("SelectOptionElement is assignable to ChatElement", () => {
    expectTypeOf<SelectOptionElement>().toMatchTypeOf<ChatElement>();
  });

  it("RadioSelectElement is assignable to ChatElement", () => {
    expectTypeOf<RadioSelectElement>().toMatchTypeOf<ChatElement>();
  });

  it("ExternalSelectElement is assignable to ChatElement", () => {
    expectTypeOf<ExternalSelectElement>().toMatchTypeOf<ChatElement>();
  });
});
