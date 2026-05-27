import { describe, expect, it } from "vitest";
import {
  emptyTwilioResponse,
  escapeXml,
  gatherSpeechTwilioResponse,
  parseTwilioVoiceCall,
  parseTwilioVoiceTranscription,
  sayTwilioResponse,
} from "./index";

describe("Twilio voice helpers", () => {
  it("parses inbound voice call webhooks", () => {
    const call = parseTwilioVoiceCall(
      new URLSearchParams({
        AccountSid: "AC123",
        CallSid: "CA123",
        Called: "+15550000001",
        Caller: "+15550000002",
      })
    );

    expect(call).toMatchObject({
      accountSid: "AC123",
      callSid: "CA123",
      from: "+15550000002",
      to: "+15550000001",
    });
  });

  it("parses Gather speech results", () => {
    const transcription = parseTwilioVoiceTranscription(
      new URLSearchParams({
        CallSid: "CA123",
        Confidence: "0.9",
        From: "+15550000002",
        SpeechResult: "hello there",
        To: "+15550000001",
      })
    );

    expect(transcription).toMatchObject({
      callSid: "CA123",
      confidence: 0.9,
      from: "+15550000002",
      text: "hello there",
      to: "+15550000001",
    });
  });

  it("parses final real-time transcription content", () => {
    const transcription = parseTwilioVoiceTranscription(
      new URLSearchParams({
        AccountSid: "AC123",
        CallSid: "CA123",
        Final: "true",
        SequenceId: "2",
        Timestamp: "2024-06-25T18:45:21.454203Z",
        Track: "outbound_track",
        TranscriptionData:
          '{"transcript":"hello from the call","confidence":0.9956335}',
        TranscriptionEvent: "transcription-content",
        TranscriptionSid: "GT123",
      })
    );

    expect(transcription).toMatchObject({
      confidence: 0.9956335,
      final: true,
      sequenceId: "2",
      text: "hello from the call",
      track: "outbound_track",
      transcriptionEvent: "transcription-content",
      transcriptionSid: "GT123",
    });
  });

  it("ignores partial real-time transcription content", () => {
    const transcription = parseTwilioVoiceTranscription(
      new URLSearchParams({
        CallSid: "CA123",
        Final: "false",
        TranscriptionData: '{"transcript":"partial words"}',
      })
    );

    expect(transcription).toBeNull();
  });

  it("parses recording transcription callbacks", () => {
    const transcription = parseTwilioVoiceTranscription(
      new URLSearchParams({
        CallSid: "CA123",
        From: "+15550000002",
        To: "+15550000001",
        TranscriptionSid: "TR123",
        TranscriptionText: "recording text",
      })
    );

    expect(transcription).toMatchObject({
      callSid: "CA123",
      text: "recording text",
      transcriptionSid: "TR123",
    });
  });

  it("renders Gather speech TwiML", async () => {
    const response = gatherSpeechTwilioResponse({
      actionUrl: "https://example.com/voice/result",
      hints: ["billing", "support"],
      language: "en-US",
      profanityFilter: false,
      prompt: 'say "hello" & continue',
      speechModel: "phone_call",
      speechTimeout: "auto",
      timeoutSeconds: 4,
      voice: "Polly.Joanna-Neural",
    });

    expect(response.headers.get("content-type")).toBe("text/xml;charset=UTF-8");
    await expect(response.text()).resolves.toBe(
      '<Response><Gather input="speech" action="https://example.com/voice/result" method="POST" actionOnEmptyResult="true" language="en-US" speechModel="phone_call" timeout="4" speechTimeout="auto" hints="billing,support" profanityFilter="false"><Say voice="Polly.Joanna-Neural" language="en-US">say &quot;hello&quot; &amp; continue</Say></Gather></Response>'
    );
  });

  it("renders simple TwiML responses", async () => {
    await expect(emptyTwilioResponse().text()).resolves.toBe(
      "<Response></Response>"
    );
    await expect(sayTwilioResponse("hello <there>").text()).resolves.toBe(
      "<Response><Say>hello &lt;there&gt;</Say></Response>"
    );
  });

  it("escapes XML attributes and content", () => {
    expect(escapeXml(`"fish" & 'chips' <ok>`)).toBe(
      "&quot;fish&quot; &amp; &apos;chips&apos; &lt;ok&gt;"
    );
  });
});
