import { notFound } from "next/navigation";
import { getAdapter, getReadme } from "@/lib/geistdocs/adapter-readme";
import {
  adaptersSource,
  getAdapterLLMText,
} from "@/lib/geistdocs/adapters-source";

export const revalidate = false;

export async function GET(
  _req: Request,
  { params }: RouteContext<"/[lang]/adapters.mdx/[[...slug]]">
) {
  const { slug, lang } = await params;
  const page = adaptersSource.getPage(slug, lang);

  if (!page) {
    notFound();
  }

  // Official adapters render their MDX body directly. Community and
  // vendor-official adapters render an upstream README (unless they opt into an
  // MDX body), so serve that same content in the markdown version.
  const type = slug?.[0];
  let body: string | undefined;
  if (type !== "official") {
    const data = page.data as unknown as { mdxBody?: boolean; slug: string };
    if (data.mdxBody !== true) {
      const adapter = getAdapter(data.slug);
      if (adapter) {
        body = await getReadme(adapter);
      }
    }
  }

  return new Response(await getAdapterLLMText(page, body), {
    headers: {
      "Content-Type": "text/markdown",
    },
  });
}

export const generateStaticParams = () => adaptersSource.generateParams();
