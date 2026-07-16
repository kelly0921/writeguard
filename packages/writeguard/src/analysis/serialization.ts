import { createHash } from "node:crypto";

function canonicalize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Analysis artifacts cannot contain non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, seen));
  if (value && typeof value === "object") {
    if (seen.has(value)) throw new TypeError("Analysis artifacts cannot contain cyclic values");
    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) output[key] = canonicalize(child, seen);
    }
    seen.delete(value);
    return output;
  }
  throw new TypeError(`Analysis artifacts must be JSON-compatible; received ${typeof value}`);
}

export function canonicalizeAnalysisArtifact(value: unknown): unknown {
  return canonicalize(value, new WeakSet<object>());
}

export function serializeAnalysisArtifact(
  value: unknown,
  options: { pretty?: boolean } = {}
): string {
  return JSON.stringify(canonicalizeAnalysisArtifact(value), null, options.pretty ? 2 : undefined);
}

export function digestAnalysisArtifact(value: unknown): string {
  return createHash("sha256").update(serializeAnalysisArtifact(value)).digest("hex");
}
