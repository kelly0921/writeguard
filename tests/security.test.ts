import { describe, expect, it } from "vitest";
import { createRequestFingerprint, redactMetadata, stableStringify } from "@writeguard/core";

describe("request identity and secret hygiene", () => {
  it("fingerprints semantically identical object input deterministically", () => {
    const left = { amount: 500, nested: { currency: "usd", targets: ["pi_1", "pi_2"] } };
    const right = { nested: { targets: ["pi_1", "pi_2"], currency: "usd" }, amount: 500 };

    expect(stableStringify(left)).toBe(stableStringify(right));
    expect(createRequestFingerprint(left)).toBe(createRequestFingerprint(right));
    expect(createRequestFingerprint(left)).not.toBe(createRequestFingerprint({ ...left, amount: 501 }));
  });

  it("redacts built-in secret names and explicitly configured nested paths", () => {
    const redacted = redactMetadata(
      {
        authorization: "Bearer secret",
        customer: { email: "kelly@example.com", privateNote: "do not persist" },
        apiKey: "sk_test_secret",
        amount: 500
      },
      ["customer.privateNote"]
    );

    expect(redacted).toEqual({
      authorization: "[REDACTED]",
      customer: { email: "kelly@example.com", privateNote: "[REDACTED]" },
      apiKey: "[REDACTED]",
      amount: 500
    });
  });
});
