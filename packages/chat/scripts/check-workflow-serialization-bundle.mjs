import { readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { basename, dirname, extname, join, resolve } from "node:path";

const distDirectory = resolve(import.meta.dirname, "../dist");
const builtinSpecifiers = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);
const serializerRegistrationPattern = /static \[WORKFLOW_SERIALIZE\d*\]/u;
const staticImportPattern =
  /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu;

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

  for (const match of source.matchAll(staticImportPattern)) {
    const specifier = match[1];
    if (!specifier) {
      continue;
    }
    if (builtinSpecifiers.has(specifier)) {
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
