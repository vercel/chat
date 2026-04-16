// Main exports

export {
  type AiAssistantMessage,
  type AiFilePart,
  type AiImagePart,
  type AiMessage,
  type AiMessagePart,
  type AiTextPart,
  type AiUserMessage,
  toAiMessages,
} from "./ai";
export {
  ChannelImpl,
  deriveChannelId,
  type SerializedChannel,
} from "./channel";
export { Chat } from "./chat";
export { fromFullStream } from "./from-full-stream";
export {
  Message,
  type MessageData,
  type SerializedMessage,
} from "./message";
export {
  MessageHistoryCache,
  type MessageHistoryConfig,
} from "./message-history";
export type {
  AddTaskOptions,
  CompletePlanOptions,
  PlanContent,
  PlanModel,
  PlanModelTask,
  PlanTask,
  PlanTaskStatus,
  StartPlanOptions,
  UpdateTaskInput,
} from "./plan";
export { Plan } from "./plan";
export type {
  PostableObject,
  PostableObjectContext,
} from "./postable-object";
export { isPostableObject } from "./postable-object";
export { reviver } from "./reviver";
export { StreamingMarkdownRenderer } from "./streaming-markdown";
export {
  StreamingPlan,
  type StreamingPlanData,
  type StreamingPlanOptions,
} from "./streaming-plan";
export { type SerializedThread, ThreadImpl } from "./thread";

// Card builders - import then re-export to ensure values are properly exported
import {
  Actions as _Actions,
  Button as _Button,
  Card as _Card,
  CardLink as _CardLink,
  CardText as _CardText,
  cardChildToFallbackText as _cardChildToFallbackText,
  Divider as _Divider,
  Field as _Field,
  Fields as _Fields,
  fromReactElement as _fromReactElement,
  Image as _Image,
  isCardElement as _isCardElement,
  LinkButton as _LinkButton,
  Section as _Section,
  Table as _Table,
} from "./cards";
import type {
  ActionsComponent,
  ButtonComponent,
  CardComponent,
  CardLinkComponent,
  DividerComponent,
  ExternalSelectComponent,
  FieldComponent,
  FieldsComponent,
  ImageComponent,
  LinkButtonComponent,
  ModalComponent,
  RadioSelectComponent,
  SectionComponent,
  SelectComponent,
  SelectOptionComponent,
  TextComponent,
  TextInputComponent,
} from "./jsx-runtime";
import {
  isJSX as _isJSX,
  toCardElement as _toCardElement,
  toModalElement as _toModalElement,
} from "./jsx-runtime";

// Cast to JSX-compatible overloaded types.
// The `as unknown as` is safe — JSX never calls these directly; the jsx factory handles resolution.
export const Actions = _Actions as unknown as ActionsComponent;
export const Button = _Button as unknown as ButtonComponent;
export const Card = _Card as unknown as CardComponent;
export const cardChildToFallbackText = _cardChildToFallbackText;
export const CardLink = _CardLink as unknown as CardLinkComponent;
export const CardText = _CardText as unknown as TextComponent;
export const Divider = _Divider as unknown as DividerComponent;
export const Field = _Field as unknown as FieldComponent;
export const Fields = _Fields as unknown as FieldsComponent;
export const fromReactElement = _fromReactElement;
export const Image = _Image as unknown as ImageComponent;
export const isCardElement = _isCardElement;
export const isJSX = _isJSX;
export const LinkButton = _LinkButton as unknown as LinkButtonComponent;
export const Section = _Section as unknown as SectionComponent;
export const Table = _Table;
export const toCardElement = _toCardElement;
export const toModalElement = _toModalElement;

// Modal builders
import {
  ExternalSelect as _ExternalSelect,
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
export const ExternalSelect =
  _ExternalSelect as unknown as ExternalSelectComponent;
export const Modal = _Modal as unknown as ModalComponent;
export const RadioSelect = _RadioSelect as unknown as RadioSelectComponent;
export const Select = _Select as unknown as SelectComponent;
export const SelectOption = _SelectOption as unknown as SelectOptionComponent;
export const TextInput = _TextInput as unknown as TextInputComponent;

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
  LinkElement,
  SectionElement,
  TableAlignment,
  TableElement,
  TableOptions,
  TextElement,
  TextStyle,
} from "./cards";
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
// JSX types
export type {
  ActionsComponent,
  ButtonComponent,
  ButtonProps,
  CardComponent,
  CardJSXElement,
  CardJSXProps,
  CardLinkComponent,
  CardLinkProps,
  CardProps,
  ChatElement,
  ContainerProps,
  DividerComponent,
  DividerProps,
  ExternalSelectComponent,
  ExternalSelectProps,
  FieldComponent,
  FieldProps,
  FieldsComponent,
  ImageComponent,
  ImageProps,
  LinkButtonComponent,
  LinkButtonProps,
  ModalComponent,
  ModalProps,
  RadioSelectComponent,
  SectionComponent,
  SelectComponent,
  SelectOptionComponent,
  SelectOptionProps,
  SelectProps,
  TextComponent,
  TextInputComponent,
  TextInputProps,
  TextProps,
} from "./jsx-runtime";
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
  Nodes,
  Paragraph,
  Root,
  Strong,
  Table as MdastTable,
  TableCell,
  TableRow,
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
  isTableCellNode,
  isTableNode,
  isTableRowNode,
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
  tableElementToAscii,
  tableToAscii,
  // AST node builders
  text,
  toPlainText,
  walkAst,
} from "./markdown";
// Modal types
export type {
  ExternalSelectElement,
  ExternalSelectOptions,
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
// Types (Plan types are exported from ./plan, PostableObject types from ./postable-object)
export type {
  ActionEvent,
  ActionHandler,
  Adapter,
  AdapterPostableMessage,
  AppHomeOpenedEvent,
  AppHomeOpenedHandler,
  AssistantContextChangedEvent,
  AssistantContextChangedHandler,
  AssistantThreadStartedEvent,
  AssistantThreadStartedHandler,
  Attachment,
  Author,
  Channel,
  ChannelInfo,
  ChannelVisibility,
  ChatConfig,
  ChatInstance,
  ConcurrencyConfig,
  ConcurrencyStrategy,
  CustomEmojiMap,
  DirectMessageHandler,
  Emoji,
  EmojiFormats,
  EmojiMapConfig,
  EphemeralMessage,
  FetchDirection,
  FetchOptions,
  FetchResult,
  FileUpload,
  FormattedContent,
  LinkPreview,
  ListThreadsOptions,
  ListThreadsResult,
  Lock,
  LockScope,
  LockScopeContext,
  Logger,
  LogLevel,
  MarkdownTextChunk,
  MemberJoinedChannelEvent,
  MemberJoinedChannelHandler,
  MentionHandler,
  MessageContext,
  MessageHandler,
  MessageMetadata,
  ModalClearResponse,
  ModalCloseEvent,
  ModalCloseHandler,
  ModalCloseResponse,
  ModalErrorsResponse,
  ModalPushResponse,
  ModalResponse,
  ModalSubmitEvent,
  ModalSubmitHandler,
  ModalUpdateResponse,
  OptionsLoadEvent,
  OptionsLoadGroup,
  OptionsLoadHandler,
  OptionsLoadResult,
  PlanUpdateChunk,
  Postable,
  PostableAst,
  PostableCard,
  PostableMarkdown,
  PostableMessage,
  PostableRaw,
  PostEphemeralOptions,
  QueueEntry,
  RawMessage,
  ReactionEvent,
  ReactionHandler,
  ScheduledMessage,
  SentMessage,
  SlashCommandEvent,
  SlashCommandHandler,
  StateAdapter,
  StreamChunk,
  StreamEvent,
  StreamOptions,
  SubscribedMessageHandler,
  TaskUpdateChunk,
  Thread,
  ThreadInfo,
  ThreadSummary,
  UserInfo,
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
