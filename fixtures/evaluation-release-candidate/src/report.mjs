import { readFile } from "node:fs/promises";
import {
  digestLocalEvaluationReport,
  parseLocalEvaluationReport,
  renderLocalEvaluationSummary
} from "@closure/writeguard-generator";

const readJson = async (name) =>
  JSON.parse(await readFile(new URL(`../artifacts/${name}`, import.meta.url), "utf8"));

const setup = await readJson("setup-result.json");
const tour = await readJson("tour-result.json");
const staticVerification = await readJson("static-verification.json");
const generatedTests = await readJson("generated-test-verification.json");
const policy = await readJson("policy-evaluation.json");
const adapterConformance = await readJson("adapter-conformance.json");

const report = parseLocalEvaluationReport({
  schemaVersion: "writeguard.local-evaluation/v1",
  kind: "writeguard_local_evaluation_report",
  tool: {
    name: "refund_order",
    consequence: "simulated_refund"
  },
  analysis: {
    ...setup.analysis,
    evaluationEvidence: "sanitized_gpt-5.6_gate_9_of_9",
    exactLivePayloadRetained: false
  },
  developerApproval: setup.developerApproval,
  generation: setup.generation,
  effects: {
    unsafeExternalEffects: tour.unsafeExternalEffects,
    guardedExternalEffects: tour.guardedExternalEffects
  },
  provider: tour.provider,
  verification: {
    static: staticVerification.receipt,
    generatedTests: generatedTests.receipt
  },
  policy,
  adapterConformance,
  cleanConsumer: {
    packedPublicPackages: true,
    workspaceAliases: false,
    privateImports: false,
    postInstallNetworkCalls: 0,
    postgresqlRequired: false
  },
  networkCalls: setup.networkCalls,
  limitations: [
    "The analysis is a deterministic recorded fixture; this command does not call GPT-5.6.",
    "The sanitized 9/9 live gate did not retain the exact live model payload used by this fixture.",
    "The provider is simulated; Stripe and real-provider semantics were not tested.",
    "Generated-test execution uses a constrained child process, not a security sandbox.",
    "The in-memory ledger is suitable only for this evaluation; deployment requires durable storage."
  ],
  nextIntegrationStep:
    "Implement a reviewed real provider boundary, use durable PostgreSQL-backed storage, and run provider-specific test-mode conformance."
});

console.log(JSON.stringify({
  report,
  reportDigest: digestLocalEvaluationReport(report),
  summary: renderLocalEvaluationSummary(report)
}));
