import { describe, expect, it } from "vitest";
import {
  classifySmsKeyword,
  computeTwilioSignature,
  twimlResponse,
  verifyTwilioSignature,
} from "@/lib/twilio-inbound";

const url = "https://example.com/api/twilio/inbound";
const params = { From: "+15551230000", Body: "STOP", MessageSid: "SM123", To: "+15559990000" };
const token = "12345";

describe("Twilio signature", () => {
  it("accepts the signature computed over the url plus sorted params", () => {
    const sig = computeTwilioSignature(url, params, token);
    expect(verifyTwilioSignature(url, params, token, sig)).toBe(true);
  });

  it("is independent of param order", () => {
    const reordered = { To: params.To, MessageSid: params.MessageSid, Body: params.Body, From: params.From };
    expect(computeTwilioSignature(url, reordered, token)).toBe(computeTwilioSignature(url, params, token));
  });

  it("rejects a missing, wrong-token, tampered-body or wrong-url signature", () => {
    const sig = computeTwilioSignature(url, params, token);
    expect(verifyTwilioSignature(url, params, token, null)).toBe(false);
    expect(verifyTwilioSignature(url, params, "other-token", sig)).toBe(false);
    expect(verifyTwilioSignature(url, { ...params, From: "+15550001111" }, token, sig)).toBe(false);
    expect(verifyTwilioSignature("https://evil.example/api/twilio/inbound", params, token, sig)).toBe(false);
    expect(verifyTwilioSignature(url, params, token, "not-a-signature")).toBe(false);
  });
});

describe("classifySmsKeyword", () => {
  it("recognises the standard opt-out words, any case, with whitespace", () => {
    for (const w of ["STOP", "stop", " Stop ", "STOPALL", "UNSUBSCRIBE", "cancel", "END", "quit"]) {
      expect(classifySmsKeyword(w)).toBe("stop");
    }
  });

  it("recognises opt-in and help", () => {
    for (const w of ["START", "yes", "UNSTOP"]) expect(classifySmsKeyword(w)).toBe("start");
    expect(classifySmsKeyword("HELP")).toBe("help");
  });

  it("treats everything else as an ordinary reply, not an opt-out", () => {
    expect(classifySmsKeyword("please stop texting me at 6am")).toBe("other");
    expect(classifySmsKeyword("")).toBe("other");
    expect(classifySmsKeyword(null)).toBe("other");
  });
});

describe("twimlResponse", () => {
  it("is empty by default and escapes message text", () => {
    expect(twimlResponse()).toContain("<Response></Response>");
    expect(twimlResponse("a < b & c")).toContain("<Message>a &lt; b &amp; c</Message>");
  });
});
