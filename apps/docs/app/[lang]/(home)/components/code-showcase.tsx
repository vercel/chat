import { highlightCode } from "@/lib/highlight-code";
import { CODE_EXAMPLE_GROUPS } from "../data/code-examples";
import {
  CodeShowcaseClient,
  type HighlightedGroup,
} from "./code-showcase-client";

export const CodeShowcase = async () => {
  const groups: HighlightedGroup[] = await Promise.all(
    CODE_EXAMPLE_GROUPS.map(async (group) => ({
      ...group,
      examples: await Promise.all(
        group.examples.map(async (tab) => {
          const lang = tab.filename.endsWith(".tsx") ? "tsx" : "typescript";
          const { modes } = tab;
          return {
            ...tab,
            tokens: await highlightCode(tab.code, lang),
            modeTokens: modes
              ? {
                  gateway: await highlightCode(modes.gateway, lang),
                  provider: await highlightCode(modes.provider, lang),
                  custom: await highlightCode(modes.custom, lang),
                }
              : undefined,
          };
        })
      ),
    }))
  );

  return <CodeShowcaseClient groups={groups} />;
};
