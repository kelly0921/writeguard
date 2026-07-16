import { createLocalPilotTelemetry } from "@closure/writeguard";

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const filePath =
  argument("file") ??
  process.env.WRITEGUARD_TELEMETRY_FILE ??
  ".writeguard/pilot-telemetry.jsonl";
const fromValue = argument("from");
const toValue = argument("to");
const from = fromValue ? new Date(fromValue) : undefined;
const to = toValue ? new Date(toValue) : undefined;
if (from && Number.isNaN(from.getTime())) throw new Error(`Invalid --from value: ${fromValue}`);
if (to && Number.isNaN(to.getTime())) throw new Error(`Invalid --to value: ${toValue}`);

const telemetry = createLocalPilotTelemetry({ filePath });
const summary = await telemetry.summary({
  ...(from ? { from } : {}),
  ...(to ? { to } : {})
});
console.log(JSON.stringify(summary, null, 2));
