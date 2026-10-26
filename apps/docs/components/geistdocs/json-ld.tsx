const SCRIPT_CLOSE_PATTERN = /</g;

interface JsonLdProps {
  data: unknown;
}

/**
 * Render schema.org structured data. Escapes `<` so content strings can never
 * close the script element early.
 */
export const JsonLd = ({ data }: JsonLdProps) => (
  <script
    // biome-ignore lint/security/noDangerouslySetInnerHtml: serialized JSON-LD with `<` escaped
    dangerouslySetInnerHTML={{
      __html: JSON.stringify(data).replace(SCRIPT_CLOSE_PATTERN, "\\u003c"),
    }}
    type="application/ld+json"
  />
);
