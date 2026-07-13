import { highlightCode } from "@/lib/highlight-code";
import { CORE_TABS } from "../data/code-examples";
import {
  CodeShowcaseClient,
  type HighlightedTab,
} from "./code-showcase-client";

export const CodeShowcase = async () => {
  const tabs: HighlightedTab[] = await Promise.all(
    CORE_TABS.map(async (tab) => ({
      ...tab,
      tokens: await highlightCode(
        tab.code,
        tab.filename.endsWith(".tsx") ? "tsx" : "typescript"
      ),
    }))
  );

  return <CodeShowcaseClient tabs={tabs} />;
};
