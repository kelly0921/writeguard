import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, parse, resolve, sep } from "node:path";
import type { GeneratedProject } from "./generate.js";
import { WriteGuardGeneratorError } from "./errors.js";

export type PublishedGeneratedProject = {
  outDir: string;
  files: string[];
};

export interface GeneratedProjectPublisher {
  publish(project: GeneratedProject, outDir: string): Promise<PublishedGeneratedProject>;
}

export type PublishGeneratedProjectOptions = {
  outDir: string;
  publisher?: GeneratedProjectPublisher;
};

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function safeRelativePath(path: string): string {
  if (!path || isAbsolute(path) || path.includes("\\")) {
    throw new WriteGuardGeneratorError(`Unsafe generated artifact path ${JSON.stringify(path)}.`);
  }
  const normalized = normalize(path).split(sep).join("/");
  if (normalized !== path || normalized === ".." || normalized.startsWith("../") ||
      path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new WriteGuardGeneratorError(`Unsafe generated artifact path ${JSON.stringify(path)}.`);
  }
  return path;
}

async function pathState(path: string): Promise<"missing" | "symlink" | "present"> {
  try {
    const state = await lstat(path);
    return state.isSymbolicLink() ? "symlink" : "present";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

async function assertNoSymlinkAncestor(path: string): Promise<void> {
  let current = dirname(path);
  const root = parse(current).root;
  while (current !== root) {
    if (await pathState(current) === "symlink") {
      throw new WriteGuardGeneratorError(
        `Refusing to publish through symlinked directory ${current}.`
      );
    }
    current = dirname(current);
  }
}

class NodeGeneratedProjectPublisher implements GeneratedProjectPublisher {
  async publish(project: GeneratedProject, outDir: string): Promise<PublishedGeneratedProject> {
    const target = resolve(outDir);
    await assertNoSymlinkAncestor(target);
    if (await pathState(target) !== "missing") {
      throw new WriteGuardGeneratorError(
        `Output directory ${target} already exists. Choose a new path; regeneration and overwrite are intentionally unsupported.`
      );
    }
    const paths = project.files.map((file) => safeRelativePath(file.path));
    if (new Set(paths).size !== paths.length) {
      throw new WriteGuardGeneratorError("Generated artifact paths must be unique.");
    }
    for (const file of project.files) {
      if (sha256(file.content) !== file.sha256) {
        throw new WriteGuardGeneratorError(`Generated artifact digest mismatch for ${file.path}.`);
      }
    }
    const manifestDigests = new Map(project.manifest.files.map((file) => [file.path, file.sha256]));
    for (const file of project.files) {
      if (file.path === project.manifest.manifestPath) continue;
      if (manifestDigests.get(file.path) !== file.sha256) {
        throw new WriteGuardGeneratorError(`Generation manifest digest mismatch for ${file.path}.`);
      }
    }
    if (manifestDigests.size !== project.files.length - 1) {
      throw new WriteGuardGeneratorError("Generation manifest file ownership does not match the artifact set.");
    }
    const parent = dirname(target);
    await mkdir(parent, { recursive: true });
    await assertNoSymlinkAncestor(target);
    const stage = join(parent, `.${basename(target)}.writeguard-stage-${randomUUID()}`);
    try {
      await mkdir(stage, { recursive: false });
      for (const file of project.files) {
        const destination = join(stage, ...file.path.split("/"));
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, file.content, { encoding: "utf8", flag: "wx" });
      }
      if (await pathState(target) !== "missing") {
        throw new WriteGuardGeneratorError(`Output path ${target} appeared during staged generation.`);
      }
      await rename(stage, target);
    } catch (error) {
      await rm(stage, { recursive: true, force: true });
      if (error instanceof WriteGuardGeneratorError) throw error;
      throw new WriteGuardGeneratorError(
        "Generated project publication failed; staged partial output was removed.",
        { cause: error }
      );
    }
    return {
      outDir: target,
      files: paths.map((path) => join(target, ...path.split("/")))
    };
  }
}

const defaultPublisher = new NodeGeneratedProjectPublisher();

export function publishGeneratedProject(
  project: GeneratedProject,
  options: PublishGeneratedProjectOptions
): Promise<PublishedGeneratedProject> {
  return (options.publisher ?? defaultPublisher).publish(project, options.outDir);
}
