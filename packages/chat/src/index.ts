// Main exports

export {
  ChannelImpl,
  deriveChannelId,
  type SerializedChannel,
} from "./channel";
export { Chat } from "./chat";
export {
  Message,
  type MessageData,
  type SerializedMessage,
} from "./message";
export { type SerializedThread, ThreadImpl } from "./thread";

// Card builders - import then re-export to ensure values are properly exported
import {
  Actions as _Actions,
  Button as _Button,
  Card as _Card,
  CardText as _CardText,
  Divider as _Divider,
  Field as _Field,
  Fields as _Fields,
  fromReactElement as _fromReactElement,
  Image as _Image,
  isCardElement as _isCardElement,
  LinkButton as _LinkButton,
  Section as _Section,
} from "./cards";
import {
  isJSX as _isJSX,
  toCardElement as _toCardElement,
  toModalElement as _toModalElement,
  type ButtonProps,
  type CardJSXElement,
  type CardJSXProps,
  type CardProps,
  type ContainerProps,
  type DividerProps,
  type FieldProps,
  type ImageProps,
  type LinkButtonProps,
  type TextProps,
} from "./jsx-runtime";
export const Actions = _Actions;
export const Button = _Button;
export const Card = _Card;
export const CardText = _CardText;
export const Divider = _Divider;
export const Field = _Field;
export const Fields = _Fields;
export const fromReactElement = _fromReactElement;
export const Image = _Image;
export const isCardElement = _isCardElement;
export const isJSX = _isJSX;
export const LinkButton = _LinkButton;
export const Section = _Section;
export const toCardElement = _toCardElement;
export const toModalElement = _toModalElement;

// Modal builders
import {
  fromReactModalElement as _fromReactModalElement,
  isModalElement as _isModalElement,
  Modal as _Modal,
  RadioSelect as _RadioSelect,
  Select as _Select,
  SelectOption as _SelectOption,
  TextInput as _TextInput,
} from "./modals";
export const fromReactModalElement = _fromReactModalElement;
export const isModalElement = _isModalElement;
export const Modal = _Modal;
export const RadioSelect = _RadioSelect;
export const Select = _Select;
export const SelectOption = _SelectOption;
export const TextInput = _TextInput;

// Card types
export type {
  ActionsElement,
  ButtonElement,
  ButtonOptions,
  ButtonStyle,
  CardChild,
  CardElement,
  CardOptions,
  DividerElement,
  FieldElement,
  FieldsElement,
  ImageElement,
  LinkButtonElement,
  LinkButtonOptions,
  SectionElement,
  TextElement,
  TextStyle,
} from "./cards";
// Modal types
export type {
  ModalChild,
  ModalElement,
  ModalOptions,
  RadioSelectElement,
  RadioSelectOptions,
  SelectElement,
  SelectOptionElement,
  SelectOptions,
  TextInputElement,
  TextInputOptions,
} from "./modals";
// JSX types
export type {
  ButtonProps,
  CardJSXElement,
  CardJSXProps,
  CardProps,
  ContainerProps,
  DividerProps,
  FieldProps,
  ImageProps,
  LinkButtonProps,
  TextProps,
};
// Emoji utilities
export {
  convertEmojiPlaceholders,
  createEmoji,
  DEFAULT_EMOJI_MAP,
  defaultEmojiResolver,
  EmojiResolver,
  type EmojiValue,
  emoji,
  getEmoji,
} from "./emoji";
// Re-export mdast types for adapters
export type {
  Blockquote,
  Code,
  Content,
  Delete,
  Emphasis,
  InlineCode,
  Link,
  List,
  ListItem,
  Paragraph,
  Root,
  Strong,
  Text,
} from "./markdown";
// Markdown/AST utilities
export {
  // Format converter base class
  BaseFormatConverter,
  blockquote,
  codeBlock,
  emphasis,
  // Types
  type FormatConverter,
  // Type guards for mdast nodes
  getNodeChildren,
  getNodeValue,
  inlineCode,
  isBlockquoteNode,
  isCodeNode,
  isDeleteNode,
  isEmphasisNode,
  isInlineCodeNode,
  isLinkNode,
  isListItemNode,
  isListNode,
  isParagraphNode,
  isStrongNode,
  isTextNode,
  link,
  type MarkdownConverter,
  markdownToPlainText,
  paragraph,
  // Parsing and stringifying
  parseMarkdown,
  root,
  strikethrough,
  stringifyMarkdown,
  strong,
  // AST node builders
  text,
  toPlainText,
  walkAst,
} from "./markdown";
// Types
export type {
  ActionEvent,
  ActionHandler,
  Adapter,
  AdapterPostableMessage,
  Attachment,
  Author,
  Channel,
  ChannelInfo,
  ChatConfig,
  ChatInstance,
  CustomEmojiMap,
  Emoji,
  EmojiFormats,
  EmojiMapConfig,
  EphemeralMessage,
  FetchDirection,
  FetchOptions,
  FetchResult,
  FileUpload,
  FormattedContent,
  ListThreadsOptions,
  ListThreadsResult,
  Lock,
  Logger,
  LogLevel,
  MentionHandler,
  MessageHandler,
  MessageMetadata,
  ModalCloseEvent,
  ModalCloseHandler,
  ModalCloseResponse,
  ModalErrorsResponse,
  ModalPushResponse,
  ModalResponse,
  ModalSubmitEvent,
  ModalSubmitHandler,
  ModalUpdateResponse,
  Postable,
  PostableAst,
  PostableCard,
  PostableMarkdown,
  PostableMessage,
  PostableRaw,
  PostEphemeralOptions,
  RawMessage,
  ReactionEvent,
  ReactionHandler,
  SentMessage,
  StateAdapter,
  StreamOptions,
  SubscribedMessageHandler,
  Thread,
  ThreadInfo,
  ThreadSummary,
  WebhookOptions,
  WellKnownEmoji,
} from "./types";
// Errors and Logger
export {
  ChatError,
  ConsoleLogger,
  LockError,
  NotImplementedError,
  RateLimitError,
  THREAD_STATE_TTL_MS,
} from "./types";
