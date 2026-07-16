import { describe, expect, it } from "vitest";
import { assertStripeTestModeKey } from "@writeguard/stripe-adapter";

describe("Stripe validation safety", () => {
  it("accepts only an explicitly test-mode credential", () => {
    expect(assertStripeTestModeKey("sk_test_...")).toBe("sk_test_...");
    expect(() => assertStripeTestModeKey("sk_live_...")).toThrow(/only accepts a test-mode/);
    expect(() => assertStripeTestModeKey(undefined)).toThrow(/STRIPE_SECRET_KEY is required/);
  });
});
