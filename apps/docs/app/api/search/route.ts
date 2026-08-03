import { createSearchRoute } from "@vercel/geistdocs/routes/search";
import { adaptersSource } from "@/lib/geistdocs/adapters-source";
import { config } from "@/lib/geistdocs/config";
import { geistdocsSource } from "@/lib/geistdocs/source";

export const GET = createSearchRoute({
  config,
  sources: [geistdocsSource, adaptersSource],
});
