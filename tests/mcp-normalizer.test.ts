import { describe, expect, it } from "vitest";
import {
  McpToolDefinitionError,
  normalizeMcpToolDefinition,
  parseNormalizedToolDefinition
} from "@closure/writeguard/analysis";
import refundTool from "../fixtures/mcp-tools/refund-order.json" with { type: "json" };
import emailTool from "../fixtures/mcp-tools/send-email.json" with { type: "json" };
import lookupTool from "../fixtures/mcp-tools/lookup-order.json" with { type: "json" };
import invalidTool from "../fixtures/mcp-tools/invalid-tool.json" with { type: "json" };
import sensitiveTool from "../fixtures/mcp-tools/sensitive-fields.json" with { type: "json" };

describe("deterministic MCP tool normalization", () => {
  it.each([
    ["refund", refundTool, "refund_order"],
    ["email", emailTool, "send_customer_email"],
    ["lookup", lookupTool, "lookup_order"]
  ])("normalizes the %s fixture without domain-specific execution behavior", (_label, fixture, name) => {
    const normalized = normalizeMcpToolDefinition(fixture, {
      serverName: "fixture-server",
      serverVersion: "1.0.0"
    });
    expect(parseNormalizedToolDefinition(normalized)).toEqual(normalized);
    expect(normalized.tool.name).toBe(name);
    expect(normalized.tool.inputSchema).toEqual(fixture.inputSchema);
    expect(normalized.provenance).toMatchObject({
      sourceKind: "mcp",
      toolName: name,
      serverName: "fixture-server",
      serverVersion: "1.0.0"
    });
  });

  it("creates stable provenance for identical normalized source", () => {
    const first = normalizeMcpToolDefinition(refundTool);
    const second = normalizeMcpToolDefinition(structuredClone(refundTool));
    expect(first.provenance.sourceId).toBe(second.provenance.sourceId);
  });

  it("detects likely redaction fields without collecting runtime values", () => {
    const normalized = normalizeMcpToolDefinition(sensitiveTool);
    expect(normalized.normalization.detectedSensitiveFieldPaths).toEqual([
      "apiKey",
      "authorizationToken",
      "cardNumber",
      "customer.email",
      "customer.phone"
    ]);
    expect(JSON.stringify(normalized)).not.toContain("credentialValue");
  });

  it("rejects invalid definitions with actionable paths", () => {
    expect(() => normalizeMcpToolDefinition(invalidTool)).toThrow(McpToolDefinitionError);
    expect(() => normalizeMcpToolDefinition(invalidTool)).toThrow(/name|inputSchema\.type/);
  });

  it("rejects credential-shaped values embedded in tool metadata", () => {
    const credential = ["sk", "test", "abcdefghijklmnop"].join("_");
    expect(() => normalizeMcpToolDefinition({
      ...refundTool,
      inputSchema: {
        ...refundTool.inputSchema,
        properties: {
          ...refundTool.inputSchema.properties,
          unsafeDefault: { type: "string", default: credential }
        }
      }
    })).toThrow(/credential-shaped values are not allowed/);
  });
});
