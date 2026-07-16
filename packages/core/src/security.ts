import { createHash } from "node:crypto";

const defaultSensitiveKey = /(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|card(?:number)?|cvc|cvv)/i;

function canonicalize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return String(value);
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return "[undefined]";
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, seen));
  if (typeof value === "object") {
    if (seen.has(value)) throw new TypeError("Cannot fingerprint cyclic input");
    seen.add(value);
    const object = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(object).sort()) {
      result[key] = canonicalize(object[key], seen);
    }
    seen.delete(value);
    return result;
  }
  return String(value);
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value, new WeakSet<object>()));
}

export function createRequestFingerprint(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function redactMetadata(
  value: Record<string, unknown> | undefined,
  sensitiveFields: readonly string[] = []
): Record<string, unknown> {
  const configured = new Set(sensitiveFields.map((field) => field.toLowerCase()));

  const visit = (current: unknown, path: string): unknown => {
    if (Array.isArray(current)) {
      return current.map((item, index) => visit(item, path ? `${path}.${index}` : String(index)));
    }
    if (current && typeof current === "object" && !(current instanceof Date) && !Buffer.isBuffer(current)) {
      const output: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
        const childPath = path ? `${path}.${key}` : key;
        if (configured.has(childPath.toLowerCase()) || defaultSensitiveKey.test(key)) {
          output[key] = "[REDACTED]";
        } else {
          output[key] = visit(child, childPath);
        }
      }
      return output;
    }
    if (current instanceof Date) return current.toISOString();
    if (Buffer.isBuffer(current)) return "[BINARY_REDACTED]";
    return current;
  };

  return (visit(value ?? {}, "") as Record<string, unknown>) ?? {};
}
