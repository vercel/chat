import fs from "node:fs";
import path from "node:path";

/**
 * Template files stored under a different name because npm excludes the real
 * name from published tarballs (npm-packlist always drops nested .gitignore
 * files, even when listed in "files").
 */
const COPY_RENAMES: Record<string, string> = {
  gitignore: ".gitignore",
};

/**
 * Recursively copy a directory, applying {@link COPY_RENAMES} to file names.
 *
 * @param source - Source directory.
 * @param destination - Destination directory.
 */
export function copyDir(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(
      destination,
      COPY_RENAMES[entry.name] ?? entry.name
    );
    if (entry.isDirectory()) {
      copyDir(sourcePath, destinationPath);
      continue;
    }
    fs.copyFileSync(sourcePath, destinationPath);
  }
}

/**
 * Read a UTF-8 project file.
 *
 * @param projectDir - Project root.
 * @param filePath - Project-relative file path.
 * @returns File contents.
 */
const readProjectFile = (projectDir: string, filePath: string): string =>
  fs.readFileSync(path.join(projectDir, filePath), "utf-8");

/**
 * Write a UTF-8 project file, creating parent directories first.
 *
 * @param projectDir - Project root.
 * @param filePath - Project-relative file path.
 * @param content - File contents.
 */
export function writeProjectFile(
  projectDir: string,
  filePath: string,
  content: string
): void {
  const fullPath = path.join(projectDir, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

/**
 * Remove a project file if it exists, then prune parent directories that became
 * empty, stopping at the project root.
 *
 * Used to clear conditionally generated files (for example the Web adapter
 * routes) when a `--force` re-run no longer selects the adapter that produced
 * them.
 *
 * @param projectDir - Project root.
 * @param filePath - Project-relative file path.
 */
export function removeProjectFile(projectDir: string, filePath: string): void {
  const root = path.resolve(projectDir);
  const fullPath = path.join(root, filePath);
  if (!fs.existsSync(fullPath)) {
    return;
  }
  fs.rmSync(fullPath);

  let dir = path.dirname(fullPath);
  while (
    path.resolve(dir) !== root &&
    fs.existsSync(dir) &&
    fs.readdirSync(dir).length === 0
  ) {
    fs.rmdirSync(dir);
    dir = path.dirname(dir);
  }
}

/**
 * Read and parse a JSON project file.
 *
 * @param projectDir - Project root.
 * @param filePath - Project-relative file path.
 * @returns Parsed JSON.
 */
export function readProjectJson<T>(projectDir: string, filePath: string): T {
  return JSON.parse(readProjectFile(projectDir, filePath)) as T;
}

/**
 * Serialize and write a JSON project file.
 *
 * @param projectDir - Project root.
 * @param filePath - Project-relative file path.
 * @param value - JSON-serializable value.
 */
export function writeProjectJson(
  projectDir: string,
  filePath: string,
  value: unknown
): void {
  writeProjectFile(projectDir, filePath, `${JSON.stringify(value, null, 2)}\n`);
}
