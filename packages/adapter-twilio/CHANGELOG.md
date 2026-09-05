# @chat-adapter/twilio

## 4.40.0

### Patch Changes

- b7c9316: Tighten AI tool and queued-message scoping, isolate direct-message conversations, preserve ephemeral follow-ups, consume callback tokens once, and mark external link metadata as untrusted.
- Updated dependencies [f485255]
- Updated dependencies [b7c9316]
- Updated dependencies [4a0b5c0]
  - chat@4.40.0
  - @chat-adapter/shared@4.40.0

## 4.39.0

### Minor Changes

- 75cadbf: feat(twilio): add RCS support with rich cards, button actions, and location sharing

  Extends the Twilio adapter with full RCS support: inbound button tap routing via `processAction`, location share parsing, Content API integration for rich outbound cards with SMS fallback, and channel metadata detection. Cards sent to RCS-capable senders (Messaging Service or `rcs:` address) are automatically rendered as Twilio Content templates with embedded SMS fallback variants.

  Existing deployments keep their thread ids: plain SMS threads stay keyed by phone number even when the number belongs to a Messaging Service, and `openDM` still prefers `phoneNumber` over `messagingServiceSid`. Only taps of buttons rendered by Chat SDK become actions; foreign button taps that carry a body keep arriving as messages.

### Patch Changes

- 28bc776: isolate Twilio message processing locks by conversation
- Updated dependencies [2ce2be0]
- Updated dependencies [153bd96]
- Updated dependencies [16ea171]
- Updated dependencies [169788b]
- Updated dependencies [eddcd7e]
- Updated dependencies [bb92688]
- Updated dependencies [5b538f6]
- Updated dependencies [e71bfea]
- Updated dependencies [929878b]
- Updated dependencies [500b7e6]
- Updated dependencies [b6fa24c]
  - chat@4.39.0
  - @chat-adapter/shared@4.39.0

## 4.38.1

### Patch Changes

- d8103a1: prevent credentials from being sent to untrusted media origins
- Updated dependencies [6cb933e]
- Updated dependencies [764e475]
  - chat@4.38.1
  - @chat-adapter/shared@4.38.1

## 4.38.0

### Patch Changes

- Updated dependencies [0f24cc3]
- Updated dependencies [bdeb2bf]
- Updated dependencies [a0cba02]
- Updated dependencies [83ede7e]
- Updated dependencies [18d4a23]
  - chat@4.38.0
  - @chat-adapter/shared@4.38.0

## 4.37.0

### Patch Changes

- Updated dependencies [2a2b2c5]
- Updated dependencies [4ac0455]
- Updated dependencies [0ec6a73]
- Updated dependencies [85e3d22]
  - chat@4.37.0
  - @chat-adapter/shared@4.37.0

## 4.36.0

### Patch Changes

- Updated dependencies [257a32d]
- Updated dependencies [c5d86b1]
- Updated dependencies [0153a39]
- Updated dependencies [b547f45]
- Updated dependencies [caa6325]
  - chat@4.36.0
  - @chat-adapter/shared@4.36.0

## 4.35.0

### Patch Changes

- Updated dependencies [80def3a]
- Updated dependencies [4cb7e5d]
- Updated dependencies [46681f5]
- Updated dependencies [93a58af]
- Updated dependencies [25f3099]
  - chat@4.35.0
  - @chat-adapter/shared@4.35.0

## 4.34.0

### Patch Changes

- Updated dependencies [5c926f1]
- Updated dependencies [2531a42]
- Updated dependencies [1721fa0]
- Updated dependencies [4717a38]
- Updated dependencies [6714efc]
  - chat@4.34.0
  - @chat-adapter/shared@4.34.0

## 4.33.0

### Patch Changes

- Updated dependencies [3abdc69]
- Updated dependencies [0b63791]
- Updated dependencies [0c761f1]
- Updated dependencies [ef2542c]
- Updated dependencies [24a04d5]
- Updated dependencies [d4c52ca]
- Updated dependencies [076fe5d]
  - chat@4.33.0
  - @chat-adapter/shared@4.33.0

## 4.32.0

### Patch Changes

- Updated dependencies [eccc6b9]
- Updated dependencies [438f551]
- Updated dependencies [d034b8b]
- Updated dependencies [06af3e1]
- Updated dependencies [2e47351]
- Updated dependencies [efa9610]
  - chat@4.32.0
  - @chat-adapter/shared@4.32.0

## 4.31.0

### Patch Changes

- Updated dependencies [778ae69]
- Updated dependencies [171657a]
  - chat@4.31.0
  - @chat-adapter/shared@4.31.0

## 4.30.0

### Minor Changes

- 25ebc3b: add Twilio SMS, MMS, and voice helpers with webhook, messaging, and formatting primitives

### Patch Changes

- 9b8d8c4: expand npm `keywords` for adapter and state packages to improve discoverability (adds `chat-sdk`, `chatbot`, `ai-agent`, `ai-sdk`, `vercel`, plus platform-specific terms)
- Updated dependencies [5461ea9]
  - chat@4.30.0
  - @chat-adapter/shared@4.30.0
