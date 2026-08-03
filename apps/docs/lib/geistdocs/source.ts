import { createSource } from "@vercel/geistdocs/source";
import { docs } from "@/.source/server";
import { config } from "./config";

export const geistdocsSource = createSource({
  docs,
  config,
  id: "docs",
  label: "Docs",
});

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = geistdocsSource.source;
export const getPageImage = geistdocsSource.getPageImage;
export const getLLMText = geistdocsSource.getPageMarkdown;
