import fs from "node:fs";
import path from "node:path";

/**
 * Recursively copy a directory.
 *
 * @param source - Source directory.
 * @param destination - Destination directory.
 */
export function copyDir(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
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
