import type { NextRequest } from "next/server";
import { adaptersSource } from "@/lib/geistdocs/adapters-source";
import { renderAdapterOg } from "../../../og-image";

interface AdapterFrontmatter {
  description: string;
  logo?: string;
  title: string;
}

export const GET = async (
  _request: NextRequest,
  { params }: { params: Promise<{ lang: string; slug: string }> }
) => {
  const { lang, slug } = await params;
  const page = adaptersSource.getPage(["community", slug], lang);

  if (!page) {
    return new Response("Not found", { status: 404 });
  }

  const data = page.data as unknown as AdapterFrontmatter;
  return renderAdapterOg({
    title: data.title,
    description: data.description,
    logo: data.logo,
  });
};

export const generateStaticParams = () =>
  adaptersSource
    .generateParams()
    .filter((entry) => entry.slug?.[0] === "community")
    .map((entry) => ({ lang: entry.lang, slug: entry.slug?.[1] }));
