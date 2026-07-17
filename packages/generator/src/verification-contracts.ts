import { digestAnalysisArtifact } from "@closure/writeguard/analysis";
import { z } from "zod";

export const VERIFICATION_CONTRACT_VERSION = "writeguard.verification/v1" as const;
export const VERIFIER_ID = "closure.writeguard-generator-verifier" as const;
export const VERIFIER_VERSION = "0.3.1" as const;

export const verificationStatuses = [
  "passed",
  "failed",
  "passed_with_limitations",
  "not_run",
  "not_applicable"
] as const;

export const verificationLevels = [
  "artifact_integrity",
  "compilation",
  "simulated_failure_behavior",
  "provider_integration_completeness",
  "real_provider_semantics"
] as const;

export const verificationModes = ["safe_static", "safe_static_and_generated_tests"] as const;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const messageSchema = z.string().min(1).max(600);
export const verificationStatusSchema = z.enum(verificationStatuses);
export const verificationLevelSchema = z.enum(verificationLevels);
export const verificationModeSchema = z.enum(verificationModes);

export const verificationDiagnosticSchema = z.object({
  code: z.string().regex(/^[a-z0-9_.-]+$/).max(100),
  message: messageSchema
}).strict();

export const verificationCheckSchema = z.object({
  id: z.string().regex(/^[a-z0-9_.-]+$/).max(100),
  level: verificationLevelSchema,
  status: verificationStatusSchema,
  summary: messageSchema,
  diagnostics: z.array(verificationDiagnosticSchema).max(20)
}).strict();

export const verificationLimitationSchema = z.object({
  code: z.string().regex(/^[a-z0-9_.-]+$/).max(100),
  level: verificationLevelSchema,
  message: messageSchema,
  nextAction: messageSchema
}).strict();

export const verificationLevelResultSchema = z.object({
  level: verificationLevelSchema,
  status: verificationStatusSchema,
  verifiedGuarantees: z.array(messageSchema).max(20),
  limitations: z.array(messageSchema).max(20)
}).strict();

export const verificationReceiptSchema = z.object({
  schemaVersion: z.literal(VERIFICATION_CONTRACT_VERSION),
  kind: z.literal("writeguard_verification_receipt"),
  verifier: z.object({
    id: z.literal(VERIFIER_ID),
    version: z.literal(VERIFIER_VERSION)
  }).strict(),
  mode: verificationModeSchema,
  overallResult: verificationStatusSchema,
  inputs: z.object({
    manifestDigest: digestSchema.nullable(),
    verificationBundleDigest: digestSchema.nullable(),
    sourceDigest: digestSchema.nullable(),
    analysisDigest: digestSchema.nullable(),
    developerReviewDigest: digestSchema.nullable(),
    providerFileDigest: digestSchema.nullable()
  }).strict(),
  outputs: z.object({
    verifiedFileSetDigest: digestSchema.nullable(),
    compiledInputDigest: digestSchema.nullable(),
    generatedTestDigest: digestSchema.nullable()
  }).strict(),
  checks: z.array(verificationCheckSchema).min(1).max(40),
  levels: z.array(verificationLevelResultSchema).length(5),
  extraFiles: z.array(z.string().min(1).max(300)).max(256),
  limitations: z.array(verificationLimitationSchema).min(1).max(30),
  nextActions: z.array(messageSchema).min(1).max(20)
}).strict();

export type VerificationStatus = z.infer<typeof verificationStatusSchema>;
export type VerificationLevel = z.infer<typeof verificationLevelSchema>;
export type VerificationMode = z.infer<typeof verificationModeSchema>;
export type VerificationDiagnostic = z.infer<typeof verificationDiagnosticSchema>;
export type VerificationCheck = z.infer<typeof verificationCheckSchema>;
export type VerificationLimitation = z.infer<typeof verificationLimitationSchema>;
export type VerificationLevelResult = z.infer<typeof verificationLevelResultSchema>;
export type VerificationReceipt = z.infer<typeof verificationReceiptSchema>;

export function parseVerificationReceipt(value: unknown): VerificationReceipt {
  return verificationReceiptSchema.parse(value);
}

export function digestVerificationReceipt(value: unknown): string {
  return digestAnalysisArtifact(parseVerificationReceipt(value));
}
