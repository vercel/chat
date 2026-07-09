import {
  defineGeistdocsSourceConfig,
  geistdocsFrontmatterSchema,
  geistdocsMetaSchema,
} from "@vercel/geistdocs/source-config";
import { defineDocs, frontmatterSchema } from "fumadocs-mdx/config";
import { z } from "zod";

// You can customise Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.dev/docs/mdx/collections
export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: geistdocsFrontmatterSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: geistdocsMetaSchema,
  },
});

const adapterFeatureStatusSchema = z.enum(["yes", "no", "partial"]);

const adapterFeatureValueSchema = z.union([
  adapterFeatureStatusSchema,
  z.string(),
  z.object({
    status: adapterFeatureStatusSchema,
    label: z.string().optional(),
  }),
]);

// Extends the base fumadocs schema rather than `geistdocsFrontmatterSchema`:
// extending the (already extended) geistdocs schema trips TypeScript's type
// instantiation depth limit, and adapter pages don't use the extra
// geistdocs-only frontmatter fields.
export const adapters = defineDocs({
  dir: "content/adapters",
  docs: {
    schema: frontmatterSchema.extend({
      packageName: z.string(),
      slug: z.string(),
      type: z.enum(["platform", "state"]),
      logo: z.string().optional(),
      tagline: z.string(),
      beta: z.boolean().optional(),
      community: z.boolean().optional(),
      vendorOfficial: z.boolean().optional(),
      author: z.string().optional(),
      features: z.record(z.string(), adapterFeatureValueSchema).optional(),
      mdxBody: z.boolean().optional(),
    }),
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: geistdocsMetaSchema,
  },
});

export default defineGeistdocsSourceConfig();
