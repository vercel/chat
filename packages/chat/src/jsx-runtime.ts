/**
 * Custom JSX runtime for chat cards.
 *
 * This allows using JSX syntax without React. Configure your bundler:
 *
 * tsconfig.json:
 * {
 *   "compilerOptions": {
 *     "jsx": "react-jsx",
 *     "jsxImportSource": "chat"
 *   }
 * }
 *
 * Or per-file:
 * /** @jsxImportSource chat *\/
 *
 * Usage:
 * ```tsx
 * import { Card, Text, Button, Actions } from "chat";
 *
 * const card = (
 *   <Card title="Order #1234">
 *     <Text>Your order is ready!</Text>
 *     <Actions>
 *       <Button id="pickup" style="primary">Schedule Pickup</Button>
 *     </Actions>
 *   </Card>
 * );
 * ```
 */

import {
  Actions,
  Button,
  type ButtonElement,
  type ButtonStyle,
  Card,
  type CardChild,
  type CardElement,
  CardLink,
  Divider,
  Field,
  type FieldElement,
  Fields,
  Image,
  LinkButton,
  type LinkButtonElement,
  type LinkElement,
  Section,
  Text,
  type TextStyle,
} from "./cards";

import {
  filterModalChildren,
  isModalElement,
  Modal,
  type ModalChild,
  type ModalElement,
  RadioSelect,
  type RadioSelectElement,
  Select,
  type SelectElement,
  SelectOption,
  type SelectOptionElement,
  TextInput,
} from "./modals";

// Symbol to identify our JSX elements before they're processed
const JSX_ELEMENT = Symbol.for("chat.jsx.element");

// ============================================================================
// JSX Props Types - Strongly typed props for each component
// ============================================================================

/** Props for Card component in JSX */
export interface CardProps {
  children?: unknown;
  imageUrl?: string;
  subtitle?: string;
  title?: string;
}

/** Props for Text component in JSX */
export interface TextProps {
  children?: string | number;
  style?: TextStyle;
}

/** Props for Button component in JSX */
export interface ButtonProps {
  children?: string | number;
  id: string;
  label?: string;
  style?: ButtonStyle;
  value?: string;
}

/** Props for LinkButton component in JSX */
export interface LinkButtonProps {
  children?: string | number;
  label?: string;
  style?: ButtonStyle;
  url: string;
}

/** Props for CardLink component in JSX */
export interface CardLinkProps {
  children?: string | number;
  label?: string;
  url: string;
}

/** Props for Image component in JSX */
export interface ImageProps {
  alt?: string;
  url: string;
}

/** Props for Field component in JSX */
export interface FieldProps {
  label: string;
  value: string;
}

/** Props for container components (Section, Actions, Fields) */
export interface ContainerProps {
  children?: unknown;
}

/** Props for Divider component (no props) */
export type DividerProps = Record<string, never>;

/** Props for Modal component in JSX */
export interface ModalProps {
  callbackId: string;
  children?: unknown;
  closeLabel?: string;
  notifyOnClose?: boolean;
  privateMetadata?: string;
  submitLabel?: string;
  title: string;
}

/** Props for TextInput component in JSX */
export interface TextInputProps {
  id: string;
  initialValue?: string;
  label: string;
  maxLength?: number;
  multiline?: boolean;
  optional?: boolean;
  placeholder?: string;
}

/** Props for Select component in JSX */
export interface SelectProps {
  children?: unknown;
  id: string;
  initialOption?: string;
  label: string;
  optional?: boolean;
  placeholder?: string;
}

/** Props for SelectOption component in JSX */
export interface SelectOptionProps {
  description?: string;
  label: string;
  value: string;
}

/** Union of all valid JSX props */
export type CardJSXProps =
  | CardProps
  | TextProps
  | ButtonProps
  | LinkButtonProps
  | CardLinkProps
  | ImageProps
  | FieldProps
  | ContainerProps
  | DividerProps
  | ModalProps
  | TextInputProps
  | SelectProps
  | SelectOptionProps;

/** Component function type with proper overloads */
type CardComponentFunction =
  | typeof Card
  | typeof Text
  | typeof Button
  | typeof LinkButton
  | typeof CardLink
  | typeof Image
  | typeof Field
  | typeof Divider
  | typeof Section
  | typeof Actions
  | typeof Fields
  | typeof Modal
  | typeof TextInput
  | typeof Select
  | typeof RadioSelect
  | typeof SelectOption;

/**
 * Represents a JSX element from the chat JSX runtime.
 * This is the type returned when using JSX syntax with chat components.
 */
export interface CardJSXElement<P extends CardJSXProps = CardJSXProps> {
  $$typeof: typeof JSX_ELEMENT;
  children: unknown[];
  props: P;
  type: CardComponentFunction;
}

// Internal alias for backwards compatibility
type JSXElement = CardJSXElement;

/**
 * Check if a value is a JSX element from our runtime.
 */
function isJSXElement(value: unknown): value is JSXElement {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as JSXElement).$$typeof === JSX_ELEMENT
  );
}

/** Non-null card element for children arrays */
type CardChildOrNested =
  | CardChild
  | ButtonElement
  | LinkButtonElement
  | LinkElement
  | FieldElement
  | SelectElement
  | SelectOptionElement
  | RadioSelectElement;

/**
 * Process children, converting JSX elements to card elements.
 */
function processChildren(children: unknown): CardChildOrNested[] {
  if (children == null) {
    return [];
  }

  if (Array.isArray(children)) {
    return children.flatMap(processChildren);
  }

  // If it's a JSX element, resolve it
  if (isJSXElement(children)) {
    const resolved = resolveJSXElement(children);
    if (resolved) {
      return [resolved as CardChildOrNested];
    }
    return [];
  }

  // If it's already a card element, return it
  if (typeof children === "object" && "type" in children) {
    return [children as CardChildOrNested];
  }

  // If it's a string or number, it might be text content for a Button or Text
  if (typeof children === "string" || typeof children === "number") {
    // Return as string, the component will handle it
    return [String(children) as unknown as CardChildOrNested];
  }

  return [];
}

/** Any card element type that can be created */
type AnyCardElement =
  | CardElement
  | CardChild
  | ButtonElement
  | LinkButtonElement
  | FieldElement
  | ModalElement
  | ModalChild
  | SelectOptionElement
  | null;

/**
 * Type guard to check if props match TextProps
 */
function isTextProps(props: CardJSXProps): props is TextProps {
  return !("id" in props || "url" in props || "label" in props);
}

/**
 * Type guard to check if props match ButtonProps
 */
function isButtonProps(props: CardJSXProps): props is ButtonProps {
  return "id" in props && typeof props.id === "string" && !("url" in props);
}

/**
 * Type guard to check if props match LinkButtonProps
 */
function isLinkButtonProps(props: CardJSXProps): props is LinkButtonProps {
  return "url" in props && typeof props.url === "string" && !("id" in props);
}

/**
 * Type guard to check if props match CardLinkProps
 */
export function isCardLinkProps(props: CardJSXProps): props is CardLinkProps {
  return (
    "url" in props &&
    typeof props.url === "string" &&
    !("id" in props) &&
    !("alt" in props) &&
    !("style" in props)
  );
}

/**
 * Type guard to check if props match ImageProps
 */
function isImageProps(props: CardJSXProps): props is ImageProps {
  return "url" in props && typeof props.url === "string";
}

/**
 * Type guard to check if props match FieldProps
 */
function isFieldProps(props: CardJSXProps): props is FieldProps {
  return (
    "label" in props &&
    "value" in props &&
    typeof props.label === "string" &&
    typeof props.value === "string"
  );
}

/**
 * Type guard to check if props match CardProps
 */
function isCardProps(props: CardJSXProps): props is CardProps {
  return (
    !("id" in props || "url" in props || "callbackId" in props) &&
    ("title" in props || "subtitle" in props || "imageUrl" in props)
  );
}

/**
 * Type guard to check if props match ModalProps
 */
function isModalProps(props: CardJSXProps): props is ModalProps {
  return "callbackId" in props && "title" in props;
}

/**
 * Type guard to check if props match TextInputProps
 */
function isTextInputProps(props: CardJSXProps): props is TextInputProps {
  return (
    "id" in props &&
    "label" in props &&
    !("options" in props) &&
    !("value" in props)
  );
}

/**
 * Type guard to check if props match SelectProps
 */
function isSelectProps(props: CardJSXProps): props is SelectProps {
  return "id" in props && "label" in props && !("value" in props);
}

/**
 * Type guard to check if props match SelectOptionProps
 */
function isSelectOptionProps(props: CardJSXProps): props is SelectOptionProps {
  return "label" in props && "value" in props && !("id" in props);
}

/**
 * Resolve a JSX element by calling its component function.
 * Transforms JSX props into the format each builder function expects.
 */
function resolveJSXElement(element: JSXElement): AnyCardElement {
  const { type, props, children } = element;

  // Process children first
  const processedChildren = processChildren(children);

  // Use identity comparison to determine which builder function this is
  // This is necessary because function names get minified in production builds
  if (type === Text) {
    // Text(content: string, options?: { style })
    // JSX children become the content string
    const textProps = isTextProps(props) ? props : { style: undefined };
    const content =
      processedChildren.length > 0
        ? processedChildren.map(String).join("")
        : String(textProps.children ?? "");
    return Text(content, { style: textProps.style });
  }

  if (type === Section) {
    // Section takes array as first argument
    return Section(processedChildren as CardChild[]);
  }

  if (type === Actions) {
    // Actions takes array of ButtonElements, LinkButtonElements, SelectElements, and RadioSelectElements
    return Actions(
      processedChildren as (
        | ButtonElement
        | LinkButtonElement
        | SelectElement
        | RadioSelectElement
      )[]
    );
  }

  if (type === Fields) {
    // Fields takes array of FieldElements
    return Fields(processedChildren as FieldElement[]);
  }

  if (type === Button) {
    // Button({ id, label, style, value })
    // JSX children become the label
    if (!isButtonProps(props)) {
      throw new Error("Button requires an 'id' prop");
    }
    const label =
      processedChildren.length > 0
        ? processedChildren.map(String).join("")
        : (props.label ?? "");
    return Button({
      id: props.id,
      label,
      style: props.style,
      value: props.value,
    });
  }

  if (type === LinkButton) {
    // LinkButton({ url, label, style })
    // JSX children become the label
    if (!isLinkButtonProps(props)) {
      throw new Error("LinkButton requires a 'url' prop");
    }
    const label =
      processedChildren.length > 0
        ? processedChildren.map(String).join("")
        : (props.label ?? "");
    return LinkButton({
      url: props.url,
      label,
      style: props.style,
    });
  }

  if (type === CardLink) {
    // CardLink({ url, label })
    // JSX children become the label
    if (!isCardLinkProps(props)) {
      throw new Error("CardLink requires a 'url' prop");
    }
    const label =
      processedChildren.length > 0
        ? processedChildren.map(String).join("")
        : (props.label ?? "");
    return CardLink({
      url: props.url,
      label,
    });
  }

  if (type === Image) {
    // Image({ url, alt })
    if (!isImageProps(props)) {
      throw new Error("Image requires a 'url' prop");
    }
    return Image({ url: props.url, alt: props.alt });
  }

  if (type === Field) {
    // Field({ label, value })
    if (!isFieldProps(props)) {
      throw new Error("Field requires 'label' and 'value' props");
    }
    return Field({
      label: props.label,
      value: props.value,
    });
  }

  if (type === Divider) {
    // Divider() - no args
    return Divider();
  }

  // Modal components
  if (type === Modal) {
    if (!isModalProps(props)) {
      throw new Error("Modal requires 'callbackId' and 'title' props");
    }
    return Modal({
      callbackId: props.callbackId,
      title: props.title,
      submitLabel: props.submitLabel,
      closeLabel: props.closeLabel,
      notifyOnClose: props.notifyOnClose,
      privateMetadata: props.privateMetadata,
      children: filterModalChildren(processedChildren),
    });
  }

  if (type === TextInput) {
    if (!isTextInputProps(props)) {
      throw new Error("TextInput requires 'id' and 'label' props");
    }
    return TextInput({
      id: props.id,
      label: props.label,
      placeholder: props.placeholder,
      initialValue: props.initialValue,
      multiline: props.multiline,
      optional: props.optional,
      maxLength: props.maxLength,
    });
  }

  if (type === Select) {
    if (!isSelectProps(props)) {
      throw new Error("Select requires 'id' and 'label' props");
    }
    return Select({
      id: props.id,
      label: props.label,
      placeholder: props.placeholder,
      initialOption: props.initialOption,
      optional: props.optional,
      options: processedChildren as SelectOptionElement[],
    });
  }

  if (type === RadioSelect) {
    if (!isSelectProps(props)) {
      throw new Error("RadioSelect requires 'id' and 'label' props");
    }
    return RadioSelect({
      id: props.id,
      label: props.label,
      initialOption: props.initialOption,
      optional: props.optional,
      options: processedChildren as SelectOptionElement[],
    });
  }

  if (type === SelectOption) {
    if (!isSelectOptionProps(props)) {
      throw new Error("SelectOption requires 'label' and 'value' props");
    }
    return SelectOption({
      label: props.label,
      value: props.value,
      description: props.description,
    });
  }

  // Default: Card({ title, subtitle, imageUrl, children })
  const cardProps = isCardProps(props) ? props : {};
  return Card({
    title: cardProps.title,
    subtitle: cardProps.subtitle,
    imageUrl: cardProps.imageUrl,
    children: processedChildren as CardChild[],
  });
}

/**
 * JSX factory function (used by the JSX transform).
 * Creates a lazy JSX element that will be resolved when needed.
 */
export function jsx<P extends CardJSXProps>(
  type: CardComponentFunction,
  props: P & { children?: unknown },
  _key?: string
): CardJSXElement<P> {
  const { children, ...restProps } = props;
  return {
    $$typeof: JSX_ELEMENT,
    type,
    props: restProps as P,
    children: children != null ? [children] : [],
  };
}

/**
 * JSX factory for elements with multiple children.
 */
export function jsxs<P extends CardJSXProps>(
  type: CardComponentFunction,
  props: P & { children?: unknown },
  _key?: string
): CardJSXElement<P> {
  const { children, ...restProps } = props;
  let resolvedChildren: unknown[];
  if (Array.isArray(children)) {
    resolvedChildren = children;
  } else if (children != null) {
    resolvedChildren = [children];
  } else {
    resolvedChildren = [];
  }
  return {
    $$typeof: JSX_ELEMENT,
    type,
    props: restProps as P,
    children: resolvedChildren,
  };
}

/**
 * Development JSX factory (same as jsx, but called in dev mode).
 */
export const jsxDEV = jsx;

/**
 * Fragment support (flattens children).
 */
export function Fragment(props: { children?: unknown }): CardChild[] {
  return processChildren(props.children) as CardChild[];
}

/**
 * Convert a JSX element tree to a CardElement.
 * Call this on the root JSX element to get a usable CardElement.
 */
export function toCardElement(jsxElement: unknown): CardElement | null {
  if (isJSXElement(jsxElement)) {
    const resolved = resolveJSXElement(jsxElement);
    if (
      resolved &&
      typeof resolved === "object" &&
      "type" in resolved &&
      resolved.type === "card"
    ) {
      return resolved as CardElement;
    }
  }

  // Already a CardElement
  if (
    typeof jsxElement === "object" &&
    jsxElement !== null &&
    "type" in jsxElement &&
    (jsxElement as CardElement).type === "card"
  ) {
    return jsxElement as CardElement;
  }

  return null;
}

export function toModalElement(jsxElement: unknown): ModalElement | null {
  if (isJSXElement(jsxElement)) {
    const resolved = resolveJSXElement(jsxElement);
    if (
      resolved &&
      typeof resolved === "object" &&
      "type" in resolved &&
      resolved.type === "modal"
    ) {
      return resolved as ModalElement;
    }
  }
  if (isModalElement(jsxElement)) {
    return jsxElement;
  }
  return null;
}

/**
 * Check if a value is a JSX element (from our runtime or React).
 */
export function isJSX(value: unknown): boolean {
  if (isJSXElement(value)) {
    return true;
  }
  // Check for React elements
  if (
    typeof value === "object" &&
    value !== null &&
    "$$typeof" in value &&
    typeof (value as { $$typeof: unknown }).$$typeof === "symbol"
  ) {
    const symbolStr = (value as { $$typeof: symbol }).$$typeof.toString();
    return (
      symbolStr.includes("react.element") ||
      symbolStr.includes("react.transitional.element")
    );
  }
  return false;
}

// biome-ignore lint/style/noNamespace: JSX namespace required by TypeScript JSX transform
export namespace JSX {
  export interface Element extends JSXElement {}
  // biome-ignore lint/complexity/noBannedTypes: Required for JSX namespace
  export type IntrinsicElements = {};
  export interface ElementChildrenAttribute {
    // biome-ignore lint/complexity/noBannedTypes: Required for JSX children attribute
    children: {};
  }
}
