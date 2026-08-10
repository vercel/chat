import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { basename, dirname, extname, join, resolve } from "node:path";
import { init, parse } from "es-module-lexer";

const packageDirectory = resolve(import.meta.dirname, "..");
const distDirectory = join(packageDirectory, "dist");
const serializerRegistrationPattern = /static \[WORKFLOW_SERIALIZE\d*\]/u;

const files = await readdir(distDirectory, { recursive: true });
const javascriptFiles = files
  .filter((file) => extname(file) === ".js")
  .map((file) => join(distDirectory, file));

const sources = new Map(
  await Promise.all(
    javascriptFiles.map(async (file) => [file, await readFile(file, "utf8")])
  )
);
const serializerFiles = javascriptFiles.filter((file) =>
  serializerRegistrationPattern.test(sources.get(file) ?? "")
);

if (serializerFiles.length === 0) {
  throw new Error(
    "Chat build did not emit any Workflow serializer registrations"
  );
}

await init;

const visited = new Set();
const queue = [...serializerFiles];
while (queue.length > 0) {
  const file = queue.pop();
  if (!file || visited.has(file)) {
    continue;
  }
  visited.add(file);

  const source = sources.get(file);
  if (!source) {
    throw new Error(
      `Missing emitted module while checking serializers: ${file}`
    );
  }

  const [imports] = parse(source);
  for (const { d: dynamicImportStart, n: specifier } of imports) {
    if (dynamicImportStart !== -1 || !specifier) {
      continue;
    }
    if (isBuiltin(specifier)) {
      throw new Error(
        `Workflow serializer bundle imports Node.js builtin "${specifier}" from ${basename(file)}`
      );
    }
    if (!specifier.startsWith(".")) {
      continue;
    }

    const importedFile = resolve(dirname(file), specifier);
    if (sources.has(importedFile)) {
      queue.push(importedFile);
    }
  }
}

const fixtureDirectory = await mkdtemp(
  join(packageDirectory, ".workflow-serialization-repro-")
);
try {
  await copyFile(
    join(packageDirectory, "fixtures/workflow-serialization.ts"),
    join(fixtureDirectory, "workflow.ts")
  );

  const workflowExecutable = join(
    packageDirectory,
    "node_modules/.bin/workflow"
  );
  const result = spawnSync(workflowExecutable, ["build"], {
    cwd: fixtureDirectory,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`Workflow serialization reproduction failed:\n${output}`);
  }
  if (/async_hooks|Serde warning/u.test(output)) {
    throw new Error(
      `Workflow serialization reproduction emitted a Node builtin warning:\n${output}`
    );
  }
} finally {
  await rm(fixtureDirectory, { recursive: true, force: true });
}
