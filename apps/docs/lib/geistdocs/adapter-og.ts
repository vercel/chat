import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const OFFICIAL_PLATFORM_OG_DIR = join(
  process.cwd(),
  "content/adapters/official/og"
);

const OFFICIAL_PLATFORM_OG_EXTENSIONS = [
  { ext: "png", contentType: "image/png" },
  { ext: "jpg", contentType: "image/jpeg" },
  { ext: "webp", contentType: "image/webp" },
] as const;

export const readOfficialPlatformOgImage = async (
  slug: string
): Promise<{ contentType: string; data: Buffer } | null> => {
  for (const { ext, contentType } of OFFICIAL_PLATFORM_OG_EXTENSIONS) {
    const path = join(OFFICIAL_PLATFORM_OG_DIR, `${slug}.${ext}`);

    try {
      await access(path);
      return {
        contentType,
        data: await readFile(path),
      };
    } catch {
      // Try the next extension.
    }
  }

  return null;
};
