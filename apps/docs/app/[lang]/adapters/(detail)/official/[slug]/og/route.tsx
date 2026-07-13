import type { NextRequest } from "next/server";
import { readOfficialPlatformOgImage } from "@/lib/geistdocs/adapter-og";
import { adaptersSource } from "@/lib/geistdocs/adapters-source";
import { renderAdapterOg } from "../../../og-image";

interface AdapterFrontmatter {
  description: string;
  logo?: string;
  title: string;
  type: "platform" | "state";
}

export const GET = async (
  _request: NextRequest,
  { params }: { params: Promise<{ lang: string; slug: string }> }
) => {
  const { lang, slug } = await params;
  const page = adaptersSource.getPage(["official", slug], lang);

  if (!page) {
    return new Response("Not found", { status: 404 });
  }

  const data = page.data as unknown as AdapterFrontmatter;

  if (data.type === "platform") {
    const staticImage = await readOfficialPlatformOgImage(slug);

    if (staticImage) {
      return new Response(new Uint8Array(staticImage.data), {
        headers: {
          "Content-Type": staticImage.contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
  }

  return renderAdapterOg({
    title: data.title,
    description: data.description,
    logo: data.logo,
  });
};

export const generateStaticParams = () =>
  adaptersSource
    .generateParams()
    .filter((entry) => entry.slug?.[0] === "official")
    .map((entry) => ({ lang: entry.lang, slug: entry.slug?.[1] }));
