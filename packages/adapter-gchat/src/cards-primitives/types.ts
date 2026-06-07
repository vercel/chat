export interface GoogleChatCard {
  card: {
    header?: GoogleChatCardHeader;
    sections: GoogleChatCardSection[];
  };
  cardId?: string;
}

export interface GoogleChatCardHeader {
  imageType?: "CIRCLE" | "SQUARE";
  imageUrl?: string;
  subtitle?: string;
  title: string;
}

export interface GoogleChatCardSection {
  collapsible?: boolean;
  header?: string;
  widgets: GoogleChatWidget[];
}

export interface GoogleChatWidget {
  buttonList?: { buttons: GoogleChatButton[] };
  decoratedText?: {
    bottomLabel?: string;
    text: string;
    topLabel?: string;
  };
  divider?: Record<string, never>;
  image?: { altText?: string; imageUrl: string };
  selectionInput?: GoogleChatSelectionInput;
  textInput?: GoogleChatTextInput;
  textParagraph?: { text: string };
}

export interface GoogleChatButton {
  onClick: {
    action?: {
      function: string;
      parameters?: Array<{ key: string; value: string }>;
    };
    openLink?: { url: string };
  };
  text: string;
}

export interface GoogleChatSelectionInput {
  items: Array<{
    selected?: boolean;
    text: string;
    value: string;
  }>;
  label: string;
  name: string;
  onChangeAction?: {
    function: string;
    parameters?: Array<{ key: string; value: string }>;
  };
  type: "DROPDOWN" | "RADIO_BUTTON";
}

export interface GoogleChatTextInput {
  label: string;
  name: string;
  type?: "MULTIPLE_LINE" | "SINGLE_LINE";
  value?: string;
}

export type GoogleChatCardElement =
  | GoogleChatActionsElement
  | GoogleChatButtonElement
  | GoogleChatDividerElement
  | GoogleChatImageElement
  | GoogleChatSectionElement
  | GoogleChatSelectElement
  | GoogleChatTextElement
  | GoogleChatTextInputElement;

export interface GoogleChatCardObject {
  children: GoogleChatCardElement[];
  imageUrl?: string;
  subtitle?: string;
  title?: string;
}

export interface GoogleChatTextElement {
  text: string;
  type: "text";
}

export interface GoogleChatSectionElement {
  children: GoogleChatCardElement[];
  header?: string;
  type: "section";
}

export interface GoogleChatActionsElement {
  children: Array<GoogleChatButtonElement | GoogleChatSelectElement>;
  type: "actions";
}

export interface GoogleChatButtonElement {
  actionId?: string;
  label: string;
  type: "button";
  url?: string;
  value?: string;
}

export interface GoogleChatSelectElement {
  actionId: string;
  label: string;
  options: Array<{ label: string; value: string }>;
  type: "select" | "radio";
  value?: string;
}

export interface GoogleChatTextInputElement {
  actionId: string;
  label: string;
  multiline?: boolean;
  type: "textInput";
  value?: string;
}

export interface GoogleChatDividerElement {
  type: "divider";
}

export interface GoogleChatImageElement {
  altText?: string;
  imageUrl: string;
  type: "image";
}

export interface GoogleChatInputRequest {
  actionId?: string;
  allowFreeform?: boolean;
  options?: Array<{ label: string; value: string }>;
  prompt: string;
  requestId: string;
  submitLabel?: string;
}
