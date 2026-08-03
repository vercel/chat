"use client";

import { GeistdocsProvider as PackageProvider } from "@vercel/geistdocs/layout";
import type { ComponentProps } from "react";
import { config } from "@/lib/geistdocs/config";

type GeistdocsProviderProps = Omit<
  ComponentProps<typeof PackageProvider>,
  "config"
> & {
  basePath: string | undefined;
  lang?: string;
};

export const GeistdocsProvider = ({
  basePath: _basePath,
  lang,
  ...props
}: GeistdocsProviderProps) => <PackageProvider config={config} lang={lang} {...props} />;
