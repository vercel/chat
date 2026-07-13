import { codeToTokens, type ThemedToken } from "shiki";

/**
 * Syntax theme that mirrors @vercel/geist's CodeBlock by emitting geist design
 * tokens (`--ds-*`) as the token colors. Because these CSS variables flip with
 * the active theme, the same highlighting adapts to light and dark mode.
 */
const GEIST_SYNTAX_THEME = {
  name: "geist",
  type: "light" as const,
  fg: "var(--ds-gray-1000)",
  bg: "transparent",
  settings: [
    { settings: { foreground: "var(--ds-gray-1000)" } },
    {
      scope: ["comment", "punctuation.definition.comment", "string.comment"],
      settings: { foreground: "var(--ds-gray-900)" },
    },
    {
      scope: [
        "constant",
        "constant.numeric",
        "constant.language",
        "constant.language.boolean",
        "entity.name.constant",
        "variable.other.constant",
        "variable.other.enummember",
        "variable.language",
        "support.constant",
      ],
      settings: { foreground: "var(--ds-blue-900)" },
    },
    {
      scope: [
        "entity.name.function",
        "meta.function-call",
        "meta.function-call.method",
        "variable.function",
        "support.function",
        "keyword.other.special-method",
        "entity.other.attribute-name",
      ],
      settings: { foreground: "var(--ds-purple-900)" },
    },
    {
      scope: [
        "keyword",
        "keyword.control",
        "keyword.operator.new",
        "keyword.operator.expression",
        "keyword.operator.logical",
        "storage",
        "storage.type",
        "storage.modifier",
      ],
      settings: { foreground: "var(--ds-pink-900)" },
    },
    {
      scope: [
        "string",
        "string.template",
        "string.quoted",
        "punctuation.definition.string",
      ],
      settings: { foreground: "var(--ds-green-900)" },
    },
    {
      scope: [
        "meta.template.expression",
        "string.regexp",
        "support.constant.property-value",
      ],
      settings: { foreground: "var(--ds-green-900)" },
    },
    {
      scope: ["variable.parameter", "meta.function.parameters"],
      settings: { foreground: "var(--ds-amber-900)" },
    },
    {
      scope: [
        "entity.name.type",
        "entity.name.class",
        "entity.other.inherited-class",
        "support.type",
        "support.class",
      ],
      settings: { foreground: "var(--ds-blue-900)" },
    },
    {
      scope: ["entity.name.tag", "punctuation.definition.tag"],
      settings: { foreground: "var(--ds-green-900)" },
    },
    {
      scope: [
        "punctuation",
        "punctuation.accessor",
        "meta.brace",
        "keyword.operator",
      ],
      settings: { foreground: "var(--ds-gray-1000)" },
    },
    {
      scope: ["variable", "meta.definition.variable.name", "support.variable"],
      settings: { foreground: "var(--ds-gray-1000)" },
    },
    {
      scope: ["markup.underline.link", "string.other.link"],
      settings: { foreground: "var(--ds-green-900)" },
    },
  ],
};

export const highlightCode = async (
  code: string,
  lang: "tsx" | "typescript" = "typescript"
): Promise<ThemedToken[][]> => {
  const { tokens } = await codeToTokens(code, {
    lang,
    theme: GEIST_SYNTAX_THEME,
  });

  return tokens;
};
