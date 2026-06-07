/** Google Chat message structure */
export interface GoogleChatMessage {
  annotations?: Array<{
    length?: number;
    startIndex?: number;
    type: string;
    userMention?: {
      type: string;
      user: { displayName?: string; name: string; type: string };
    };
  }>;
  argumentText?: string;
  attachment?: Array<{
    attachmentDataRef?: { resourceName?: null | string } | null;
    contentName: string;
    contentType: string;
    downloadUri?: string;
    name: string;
  }>;
  createTime: string;
  formattedText?: string;
  name: string;
  sender: {
    avatarUrl?: string;
    displayName: string;
    email?: string;
    name: string;
    type: string;
  };
  space?: GoogleChatSpace;
  text: string;
  thread?: {
    name: string;
  };
}

/** Google Chat space structure */
export interface GoogleChatSpace {
  displayName?: string;
  name: string;
  /** Whether this is a single-user DM with the bot */
  singleUserBotDm?: boolean;
  spaceThreadingState?: string;
  /** Space type in newer API format: "SPACE", "GROUP_CHAT", "DIRECT_MESSAGE" */
  spaceType?: string;
  type: string;
}

/** Google Chat user structure */
export interface GoogleChatUser {
  displayName: string;
  email?: string;
  name: string;
  type: string;
}

export interface GoogleChatFormInput {
  stringInputs?: {
    value?: string[];
  };
}

export type GoogleChatFormInputs = Record<string, GoogleChatFormInput>;

/**
 * Google Workspace Add-ons event format.
 * This is the format used when configuring the app via Google Cloud Console.
 */
export interface GoogleChatEvent {
  chat?: {
    /** Present when the bot is added to a space */
    addedToSpacePayload?: {
      space: GoogleChatSpace;
    };
    /** Present when a card button is clicked */
    buttonClickedPayload?: {
      message: GoogleChatMessage;
      space: GoogleChatSpace;
      user: GoogleChatUser;
    };
    eventTime?: string;
    messagePayload?: {
      message: GoogleChatMessage;
      space: GoogleChatSpace;
    };
    /** Present when the bot is removed from a space */
    removedFromSpacePayload?: {
      space: GoogleChatSpace;
    };
    user?: GoogleChatUser;
  };
  commonEventObject?: {
    formInputs?: GoogleChatFormInputs;
    /** The function name invoked (for card clicks) */
    invokedFunction?: string;
    /** Parameters passed to the function */
    parameters?: Record<string, string>;
    hostApp?: string;
    platform?: string;
    userLocale?: string;
  };
}

export interface GoogleChatContinuation {
  isDM?: boolean;
  messageName?: string;
  spaceName: string;
  threadName?: string;
  transport: "direct" | "pubsub";
}

export interface PubSubPushMessage {
  message: {
    /** Base64 encoded event data */
    data: string;
    attributes?: Record<string, string>;
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

/** Google Chat reaction data */
export interface GoogleChatReaction {
  /** The emoji */
  emoji?: {
    unicode?: string;
  };
  /** Reaction resource name */
  name: string;
  /** The user who added/removed the reaction */
  user?: {
    displayName?: string;
    name: string;
    type?: string;
  };
}

/** Decoded Workspace Events notification payload */
export interface WorkspaceEventNotification {
  /** When the event occurred */
  eventTime: string;
  /** Event type (e.g., "google.workspace.chat.message.v1.created") */
  eventType: string;
  /** Present for message.created events */
  message?: GoogleChatMessage;
  /** Present for reaction.created/deleted events */
  reaction?: GoogleChatReaction;
  /** Space info */
  space?: {
    name: string;
    type: string;
  };
  /** The subscription that triggered this event */
  subscription: string;
  /** The resource being watched (e.g., "//chat.googleapis.com/spaces/AAAA") */
  targetResource: string;
}

export type GoogleChatWebhookPayload =
  | GoogleChatAddedToSpacePayload
  | GoogleChatCardClickedPayload
  | GoogleChatMessagePayload
  | GoogleChatRemovedFromSpacePayload
  | GoogleChatUnsupportedPayload
  | GoogleChatWorkspaceMessagePayload
  | GoogleChatWorkspaceReactionPayload;

export interface GoogleChatPayloadBase {
  continuation?: GoogleChatContinuation;
  raw: unknown;
}

export interface GoogleChatMessagePayload extends GoogleChatPayloadBase {
  kind: "message";
  message: GoogleChatMessage;
  space: GoogleChatSpace;
}

export interface GoogleChatCardClickedPayload extends GoogleChatPayloadBase {
  actionId?: string;
  kind: "card_clicked";
  message?: GoogleChatMessage;
  parameters?: Record<string, string>;
  space?: GoogleChatSpace;
  user?: GoogleChatUser;
  value?: string;
}

export interface GoogleChatAddedToSpacePayload extends GoogleChatPayloadBase {
  kind: "added_to_space";
  space: GoogleChatSpace;
}

export interface GoogleChatRemovedFromSpacePayload
  extends GoogleChatPayloadBase {
  kind: "removed_from_space";
  space: GoogleChatSpace;
}

export interface GoogleChatWorkspaceMessagePayload
  extends GoogleChatPayloadBase {
  kind: "workspace_message";
  message: GoogleChatMessage;
  notification: WorkspaceEventNotification;
}

export interface GoogleChatWorkspaceReactionPayload
  extends GoogleChatPayloadBase {
  kind: "workspace_reaction";
  notification: WorkspaceEventNotification;
  reaction: GoogleChatReaction;
}

export interface GoogleChatUnsupportedPayload extends GoogleChatPayloadBase {
  kind: "unsupported";
  reason: string;
}
