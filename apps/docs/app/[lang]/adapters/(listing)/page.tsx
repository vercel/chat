import type { Metadata } from "next";
import adapters from "@/adapters.json";
import {
  ADAPTERS_LISTING_DESCRIPTION,
  getAdaptersListingJsonLd,
} from "@/lib/geistdocs/adapter-jsonld";
import { AdaptersGrid } from "../components/adapters-grid";

export const metadata: Metadata = {
  title: "Adapters",
  description: ADAPTERS_LISTING_DESCRIPTION,
  openGraph: {
    title: "Adapters",
    images: "/opengraph-image.png",
  },
  twitter: {
    card: "summary_large_image",
  },
};

const jsonLd = getAdaptersListingJsonLd(adapters);

const AdaptersPage = () => (
  <div className="container mx-auto max-w-5xl">
    <script
      // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD, not user input
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      type="application/ld+json"
    />
    <section className="mt-(--fd-nav-height) space-y-4 px-4 pt-16 pb-8 sm:pt-24">
      <h1 className="text-balance font-semibold text-4xl leading-[1.1] tracking-tight sm:text-[44px]">
        Adapters
      </h1>
      <p className="max-w-2xl text-[15px] text-muted-foreground leading-[1.55]">
        {ADAPTERS_LISTING_DESCRIPTION}
      </p>
    </section>

    <div className="grid gap-10 px-4 pb-16">
      <AdaptersGrid adapters={adapters} />
    </div>
  </div>
);

export default AdaptersPage;
