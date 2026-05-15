import { type InferPageType, loader } from "fumadocs-core/source";
import { adapters } from "@/.source/server";
import { basePath } from "@/geistdocs";
import { i18n } from "./i18n";

export const adaptersSource = loader({
  i18n,
  baseUrl: "/adapters",
  source: adapters.toFumadocsSource(),
});

export type AdapterPage = InferPageType<typeof adaptersSource>;

export const getAdapterPageImage = (page: AdapterPage) => {
  const segments = [...page.slugs, "image.png"];

  return {
    segments,
    url: basePath
      ? `${basePath}/og/${segments.join("/")}`
      : `/og/${segments.join("/")}`,
  };
};
