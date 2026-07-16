import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { isUnknownExecutionOutcome } from "@closure/writeguard";
import { StarterRefundWorkflow, type StarterRefundRequest } from "./workflow.js";

export type StarterMode = "shadow" | "enforced";

export function createStarterMcpServer(workflow: StarterRefundWorkflow, mode: StarterMode): McpServer {
  const server = new McpServer({ name: "writeguard-design-partner-starter", version: "0.3.0" });
  server.registerTool(
    "refund_order",
    {
      description: `Refund-order design-partner starter in ${mode} mode`,
      inputSchema: {
        caseId: z.string().min(1),
        tenantId: z.string().min(1),
        orderId: z.string().min(1),
        paymentIntentId: z.string().min(1),
        amount: z.number().int().positive(),
        currency: z.string().length(3),
        frameworkToolCallId: z.string().min(1)
      },
      annotations: {
        readOnlyHint: mode === "shadow",
        destructiveHint: mode === "enforced",
        idempotentHint: mode === "enforced",
        openWorldHint: true
      }
    },
    async (input) => {
      try {
        const result =
          mode === "shadow"
            ? await workflow.observe(input as StarterRefundRequest)
            : await workflow.enforce(input as StarterRefundRequest);
        return {
          content: [{ type: "text", text: JSON.stringify({ mode, result }) }],
          structuredContent: { mode, result }
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                mode,
                status: isUnknownExecutionOutcome(error) ? "UNKNOWN" : "ERROR",
                message: error instanceof Error ? error.message : String(error)
              })
            }
          ],
          isError: true
        };
      }
    }
  );
  return server;
}

export async function connectStarterMcpClient(server: McpServer): Promise<{
  client: Client;
  close(): Promise<void>;
}> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "starter-test-client", version: "0.3.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    }
  };
}
