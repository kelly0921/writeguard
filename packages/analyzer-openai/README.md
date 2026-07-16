# @closure/writeguard-analyzer-openai

Optional design-time GPT-5.6 risk analysis for normalized MCP tools. This package implements the public `ToolRiskAnalyzer` boundary from `@closure/writeguard/analysis`; it is not imported by WriteGuard execution, storage, reconciliation, or tracing.

```ts
import { normalizeMcpToolDefinition, runToolRiskAnalyzer } from "@closure/writeguard/analysis";
import { createOpenAIToolRiskAnalyzer } from "@closure/writeguard-analyzer-openai";

const tool = normalizeMcpToolDefinition(mcpToolJson);
const analysis = await runToolRiskAnalyzer(createOpenAIToolRiskAnalyzer(), tool);
```

Set `OPENAI_API_KEY` in the process environment. Do not put it in source, JSON fixtures, command arguments, or `.env` files that could be committed. The fixed model target is `gpt-5.6`; the analyzer returns an actionable error instead of silently falling back.

For a local PowerShell session, read the key without echoing it or placing it in shell history:

```powershell
$secureKey = Read-Host "OpenAI API key" -AsSecureString
$env:OPENAI_API_KEY = [Net.NetworkCredential]::new("", $secureKey).Password
pnpm eval:openai-live
Remove-Item Env:OPENAI_API_KEY
```

`pnpm eval:openai-live` runs nine safe fixtures sequentially with zero SDK retries and writes only fixture name, model identity, pass/fail state, and sanitized diagnostic codes to `.writeguard/openai-live-evaluation.json`. It refuses to run without the key and never prints it. The deterministic standard suite uses injected transports and incurs no API spend.

The complete normalized tool definition is sent to OpenAI. Remove real credentials, personal data, and sensitive example/default values first. WriteGuard rejects common credential-shaped metadata, but that is not a complete data-loss-prevention system.

The Responses API request uses strict structured output. The model-facing shape excludes provenance, analyzer identity, approval state, and contract version. Trusted code adds those fields, validates the public `writeguard.analysis/v1` contract, verifies input field references and redaction coverage, and rejects unsupported provider guarantees. Recommendations remain `recommendation_only`, shadow-mode proposals requiring developer approval.

The SDK performs at most one retry by default for the transient categories it supports. Analysis has no external side effect, but a retry can create another billed model request. Configure `maxRetries: 0` when minimizing spend is more important than transient recovery. The default request timeout is 60 seconds.

Prompt hierarchy, data boundaries, structured output, runtime validation, and adversarial tests reduce prompt-injection risk; they do not provide complete prompt-injection immunity. Deterministic WriteGuard enforcement—not model analysis—provides the runtime safety boundary.
