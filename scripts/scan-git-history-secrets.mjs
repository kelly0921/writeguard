import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const patterns = [
  { name: "Stripe secret key", expression: /sk_(?:test|live)_[A-Za-z0-9]{12,}/g },
  { name: "OpenAI API key", expression: /sk-proj-[A-Za-z0-9_-]{12,}/g },
  { name: "GitHub token", expression: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: "AWS access key", expression: /AKIA[0-9A-Z]{16}/g }
];

function git(args) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
  if (result.error) throw result.error;
  return result;
}

const revisions = git(["rev-list", "--all"]);
if (revisions.status !== 0) {
  console.error("Unable to enumerate Git history for secret scanning.");
  process.exit(2);
}

const commits = revisions.stdout.split(/\r?\n/u).filter(Boolean);
const gitExpression = patterns
  .map(({ expression }) => expression.source)
  .join("|")
  .replaceAll("(?:", "(");
const findings = new Map();

for (const commit of commits) {
  const result = git(["grep", "-I", "-n", "-E", gitExpression, commit, "--"]);
  if (result.status === 1) continue;
  if (result.status !== 0) {
    console.error(`Unable to scan Git commit ${commit.slice(0, 12)}.`);
    process.exit(2);
  }

  for (const record of result.stdout.split(/\r?\n/u).filter(Boolean)) {
    const parsed = record.match(/^([0-9a-f]+):(.+?):(\d+):(.*)$/u);
    if (!parsed) continue;
    const [, revision, path, line, content] = parsed;
    for (const pattern of patterns) {
      pattern.expression.lastIndex = 0;
      for (const match of content.matchAll(pattern.expression)) {
        const fingerprint = createHash("sha256").update(match[0]).digest("hex").slice(0, 12);
        const key = `${pattern.name}:${fingerprint}:${revision}:${path}:${line}`;
        findings.set(key, {
          name: pattern.name,
          fingerprint,
          revision: revision.slice(0, 12),
          path,
          line
        });
      }
    }
  }
}

if (findings.size > 0) {
  console.error(`Potential credential-shaped values found in reachable Git history (${findings.size}):`);
  for (const finding of [...findings.values()].slice(0, 50)) {
    console.error(
      `${finding.name} fingerprint=${finding.fingerprint} commit=${finding.revision} path=${finding.path}:${finding.line}`
    );
  }
  if (findings.size > 50) console.error(`Additional findings omitted: ${findings.size - 50}`);
  process.exitCode = 1;
} else {
  console.log(`Git history secret scan passed across ${commits.length} reachable commits.`);
}
