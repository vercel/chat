import { createMdxComponents } from "@vercel/geistdocs/mdx";
import type { MDXComponents } from "mdx/types";
import { Check, Cross, Warn } from "@/components/custom/status-icons";
import { AdapterSlugList } from "./adapter-slug-list";
import { FeatureSupport } from "./feature-support";
import { GlobalFeatureMatrix } from "./global-feature-matrix";
import { PackageInstall } from "./package-install";

export const getMDXComponents = (
  components?: MDXComponents
): MDXComponents =>
  createMdxComponents({
    Check,
    Cross,
    Warn,

    FeatureSupport,
    GlobalFeatureMatrix,
    AdapterSlugList,
    PackageInstall,

    // User components last to allow overwriting defaults
    ...components,
  });
