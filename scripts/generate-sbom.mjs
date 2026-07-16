import { createRequire } from "node:module";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(root, "packages", "writeguard");
const output = join(root, ".writeguard", "writeguard-sbom.cdx.json");
const components = new Map();
const dependencyGraph = new Map();

async function locateManifest(specifier, parentManifest) {
  const requireFromParent = createRequire(parentManifest);
  const entry = await realpath(requireFromParent.resolve(specifier));
  let directory = dirname(entry);
  while (directory !== dirname(directory)) {
    const candidate = join(directory, "package.json");
    try {
      const manifest = JSON.parse(await readFile(candidate, "utf8"));
      if (manifest.name === specifier) return { path: candidate, manifest };
    } catch {
      // Continue toward the dependency package root.
    }
    directory = dirname(directory);
  }
  throw new Error(`Could not locate package manifest for ${specifier}`);
}

function licenseExpression(manifest) {
  if (typeof manifest.license === "string") return manifest.license;
  if (Array.isArray(manifest.licenses)) {
    return manifest.licenses.map((item) => typeof item === "string" ? item : item?.type).filter(Boolean).join(" OR ");
  }
  return "NOASSERTION";
}

async function visit(name, parentManifest) {
  const located = await locateManifest(name, parentManifest);
  const key = `${located.manifest.name}@${located.manifest.version}`;
  if (components.has(key)) return key;
  components.set(key, {
    type: "library",
    name: located.manifest.name,
    version: located.manifest.version,
    "bom-ref": `pkg:npm/${encodeURIComponent(located.manifest.name)}@${located.manifest.version}`,
    licenses: [{ license: { expression: licenseExpression(located.manifest) } }],
    purl: `pkg:npm/${encodeURIComponent(located.manifest.name)}@${located.manifest.version}`
  });
  const childKeys = [];
  for (const dependency of Object.keys(located.manifest.dependencies ?? {}).sort()) {
    childKeys.push(await visit(dependency, located.path));
  }
  dependencyGraph.set(key, childKeys);
  return key;
}

const packageManifestPath = join(packageRoot, "package.json");
const packageManifest = JSON.parse(await readFile(packageManifestPath, "utf8"));
const rootRef = `pkg:npm/${encodeURIComponent(packageManifest.name)}@${packageManifest.version}`;
const directKeys = [];
for (const dependency of Object.keys(packageManifest.dependencies ?? {}).sort()) {
  directKeys.push(await visit(dependency, packageManifestPath));
}
const refFor = (key) => components.get(key)["bom-ref"];
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: "urn:uuid:00000000-0000-4000-8000-000000000003",
  version: 1,
  metadata: {
    component: {
      type: "library",
      name: packageManifest.name,
      version: packageManifest.version,
      "bom-ref": rootRef,
      purl: rootRef
    }
  },
  components: [...components.values()].sort((left, right) => left.purl.localeCompare(right.purl)),
  dependencies: [
    { ref: rootRef, dependsOn: directKeys.map(refFor).sort() },
    ...[...dependencyGraph.entries()]
      .map(([key, children]) => ({ ref: refFor(key), dependsOn: children.map(refFor).sort() }))
      .sort((left, right) => left.ref.localeCompare(right.ref))
  ]
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
console.log(`CycloneDX SBOM generated with ${components.size} runtime dependency components.`);
