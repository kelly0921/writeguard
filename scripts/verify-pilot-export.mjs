import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const path = join(resolve(process.cwd()), ".writeguard", "pilot-export.json");
const content = await readFile(path, "utf8");
const forbiddenNames = [
  "operationKey",
  "operationId",
  "receiptId",
  "providerReference",
  "paymentIntent",
  "customerId",
  "toolCallId",
  "requestBody",
  "responseBody",
  "secretKey",
  "databaseUrl"
];
for (const name of forbiddenNames) {
  if (content.toLowerCase().includes(name.toLowerCase())) {
    throw new Error(`Sanitized pilot export contains forbidden field or value: ${name}`);
  }
}
const parsed = JSON.parse(content);
const expectedTopLevel = [
  "schemaVersion",
  "generatedAt",
  "evaluationOnly",
  "sdkVersion",
  "pilotConfiguration",
  "observationPeriod",
  "aggregates"
];
const actualTopLevel = Object.keys(parsed).sort();
if (JSON.stringify(actualTopLevel) !== JSON.stringify([...expectedTopLevel].sort())) {
  throw new Error("Sanitized pilot export has an unexpected top-level schema");
}
console.log("Pilot export redaction check passed: aggregate schema only, no forbidden identifiers or payload fields.");
