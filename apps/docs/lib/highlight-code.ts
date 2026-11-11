import { geistShikiTheme } from "@vercel/geistdocs/shiki-theme";
import { cacheLife } from "next/cache";
import { codeToTokens, type ThemedToken } from "shiki";

export const highlightCode = async (
  code: string,
  lang: "tsx" | "typescript" = "typescript"
): Promise<ThemedToken[][]> => {
  // Shiki reads unstable values (e.g. Date.now) internally; cache the result
  // so pages using this helper stay prerenderable under Cache Components.
  "use cache";
  cacheLife("max");

  const { tokens } = await codeToTokens(code, {
    lang,
    theme: geistShikiTheme,
  });

  return tokens;
};
