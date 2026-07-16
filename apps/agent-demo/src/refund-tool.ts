import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  classifyError,
  type ExecutionReceipt,
  type FakeRefund,
  type FakeRefundProviderContract,
  UnknownExecutionOutcome
} from "@writeguard/core";
import { WriteGuard } from "@writeguard/sdk";
import { z } from "zod";

export type RefundOrderInput = {
  tenantId: string;
  orderId: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
};

export type RefundToolCallInput = RefundOrderInput & {
  frameworkToolCallId: string;
};

export function refundOperationKey(input: Pick<RefundOrderInput, "tenantId" | "orderId" | "amount" | "currency">): string {
  return `${input.tenantId}:${input.orderId}:refund:${input.currency.toLowerCase()}:${input.amount}`;
}

function receiptOutput(receipt: ExecutionReceipt): Record<string, unknown> {
  return {
    operationId: receipt.operationId,
    operationKey: receipt.operationKey,
    status: receipt.status,
    verified: receipt.verified,
    providerReference: receipt.providerReference,
    attempts: receipt.attempts,
    resolution: receipt.resolution,
    duplicateExecutionPrevented: receipt.duplicateExecutionPrevented,
    unresolvedEffects: receipt.unresolvedEffects,
    completedAt: receipt.completedAt.toISOString()
  };
}

export function createRefundOrderMcpServer(options: {
  writeGuard: WriteGuard;
  provider: FakeRefundProviderContract;
}): McpServer {
  const guardedRefund = options.writeGuard.guardTool<RefundOrderInput, FakeRefund>({
    name: "refund_order",
    description: "Refund an order once using a stable business-operation identity",
    provider: "fake-payments",
    effectType: "irreversible_write",
    getOperationKey: refundOperationKey,
    getFingerprint: ({ tenantId, orderId, paymentIntentId, amount, currency }) => ({
      tenantId,
      orderId,
      paymentIntentId,
      amount,
      currency: currency.toLowerCase()
    }),
    getMetadata: ({ tenantId, orderId, paymentIntentId, amount, currency }) => ({
      tenantId,
      orderId,
      paymentIntentId,
      amount,
      currency: currency.toLowerCase()
    }),
    execute: (input, context) =>
      options.provider.createRefund({
        operationId: context.operationId,
        paymentIntentId: input.paymentIntentId,
        amount: input.amount,
        currency: input.currency.toLowerCase()
      }),
    reconcile: (input, context) =>
      options.provider.reconcile(context.operationId, input.paymentIntentId),
    verify: async (refund, input, context) =>
      refund.status === "succeeded" &&
      refund.operationId === context.operationId &&
      refund.paymentIntentId === input.paymentIntentId &&
      refund.amount === input.amount &&
      refund.currency === input.currency.toLowerCase(),
    getProviderReference: (refund) => refund.id,
    getVerificationEvidence: (refund, input, context) => ({
      provider: "fake-payments",
      refundId: refund.id,
      refundStatus: refund.status,
      amountMatches: refund.amount === input.amount,
      currencyMatches: refund.currency === input.currency.toLowerCase(),
      operationMetadataMatches: refund.operationId === context.operationId
    })
  });

  const server = new McpServer({ name: "writeguard-refund-demo", version: "0.2.0" });
  server.registerTool(
    "refund_order",
    {
      title: "Refund order safely",
      description:
        "Refund an order. frameworkToolCallId is trace metadata only; tenant/order/amount/currency define durable identity.",
      inputSchema: {
        tenantId: z.string().min(1),
        orderId: z.string().min(1),
        paymentIntentId: z.string().min(1),
        amount: z.number().int().positive(),
        currency: z.string().length(3),
        frameworkToolCallId: z.string().min(1)
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ frameworkToolCallId, ...input }) => {
      const stableKey = refundOperationKey(input);
      try {
        const receipt = await guardedRefund.invoke(input, {
          framework: "mcp",
          toolCallId: frameworkToolCallId,
          metadata: { businessIntent: "refund_order" }
        });
        const output = {
          frameworkToolCallId,
          stableOperationKey: stableKey,
          receipt: receiptOutput(receipt)
        };
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output
        };
      } catch (error) {
        const classified = classifyError(error);
        const output = {
          frameworkToolCallId,
          stableOperationKey: stableKey,
          status: error instanceof UnknownExecutionOutcome ? "UNKNOWN" : "ERROR",
          errorType: classified.type,
          message: classified.message
        };
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
          isError: true
        };
      }
    }
  );
  return server;
}

export async function connectInMemoryMcpClient(server: McpServer): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "writeguard-validation-client", version: "0.2.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    }
  };
}

export async function callRefundOrderTool(client: Client, input: RefundToolCallInput) {
  return client.callTool({ name: "refund_order", arguments: input });
}
