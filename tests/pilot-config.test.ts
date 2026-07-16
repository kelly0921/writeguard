import { describe, expect, it } from "vitest";
import { parsePilotConfig } from "../apps/pilot-sandbox/src/config.js";

describe("pilot configuration", () => {
  it("uses safe credential-free shadow defaults", () => {
    const config = parsePilotConfig({}, { cwd: process.cwd(), requireLocalDatabase: true });
    expect(config).toMatchObject({
      mode: "shadow",
      provider: "fake",
      storage: "postgresql",
      telemetryEnabled: true,
      reconciliationEnabled: true,
      failClosedOnStorageError: true,
      sensitiveFieldPolicy: "omit"
    });
  });

  it("rejects live Stripe credentials before adapter initialization", () => {
    expect(() =>
      parsePilotConfig({ STRIPE_SECRET_KEY: ["sk", "live", "not-a-real-key"].join("_") })
    ).toThrow(/Live Stripe credentials are rejected/);
  });

  it("rejects unsafe operational settings", () => {
    expect(() => parsePilotConfig({ PILOT_FAIL_CLOSED_ON_STORAGE_ERROR: "false" })).toThrow(
      /must remain true/
    );
    expect(() => parsePilotConfig({ PILOT_RECONCILIATION_ENABLED: "false" })).toThrow(
      /must remain true/
    );
    expect(() =>
      parsePilotConfig(
        { PILOT_DATABASE_URL: "postgresql://pilot:pilot@example.invalid:5432/pilot" },
        { requireLocalDatabase: true }
      )
    ).toThrow(/localhost PostgreSQL/);
  });
});
