import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import adapters from "@/adapters.json";
import { AdapterCard } from "../../components/adapter-card";

// Define messenger categories and which adapters support them
const messengerConfig: Record<
  string,
  {
    name: string;
    description: string;
    // Adapter slugs that support this messenger
    adapterSlugs: string[];
    // Also match adapters by description keywords
    keywords?: string[];
  }
> = {
  imessage: {
    name: "iMessage",
    description:
      "Build bots for iMessage with Chat SDK. Browse official and community adapters that support iMessage integration.",
    adapterSlugs: ["imessage", "sendblue"],
    keywords: ["imessage"],
  },
  whatsapp: {
    name: "WhatsApp",
    description:
      "Build bots for WhatsApp with Chat SDK. Browse official and community adapters that support WhatsApp integration.",
    adapterSlugs: ["whatsapp", "baileys", "zernio"],
    keywords: ["whatsapp"],
  },
  telegram: {
    name: "Telegram",
    description:
      "Build bots for Telegram with Chat SDK. Browse official and community adapters that support Telegram integration.",
    adapterSlugs: ["telegram", "zernio"],
    keywords: ["telegram"],
  },
  slack: {
    name: "Slack",
    description:
      "Build bots for Slack with Chat SDK. Browse official and community adapters that support Slack integration.",
    adapterSlugs: ["slack"],
    keywords: ["slack"],
  },
  discord: {
    name: "Discord",
    description:
      "Build bots for Discord with Chat SDK. Browse official and community adapters that support Discord integration.",
    adapterSlugs: ["discord"],
    keywords: ["discord"],
  },
  teams: {
    name: "Microsoft Teams",
    description:
      "Build bots for Microsoft Teams with Chat SDK. Browse official and community adapters that support Teams integration.",
    adapterSlugs: ["teams"],
    keywords: ["teams", "microsoft teams"],
  },
  matrix: {
    name: "Matrix",
    description:
      "Build bots for Matrix with Chat SDK. Browse official and community adapters that support Matrix integration.",
    adapterSlugs: ["matrix"],
    keywords: ["matrix"],
  },
  instagram: {
    name: "Instagram",
    description:
      "Build bots for Instagram DMs with Chat SDK. Browse official and community adapters that support Instagram integration.",
    adapterSlugs: ["instagram", "zernio"],
    keywords: ["instagram"],
  },
  facebook: {
    name: "Facebook Messenger",
    description:
      "Build bots for Facebook Messenger with Chat SDK. Browse official and community adapters that support Messenger integration.",
    adapterSlugs: ["messenger", "zernio"],
    keywords: ["messenger", "facebook"],
  },
  twitter: {
    name: "X (Twitter)",
    description:
      "Build bots for X (Twitter) DMs with Chat SDK. Browse official and community adapters that support X integration.",
    adapterSlugs: ["x", "zernio"],
    keywords: ["twitter", "x/twitter"],
  },
  github: {
    name: "GitHub",
    description:
      "Build bots for GitHub issues and PRs with Chat SDK. Browse official and community adapters that support GitHub integration.",
    adapterSlugs: ["github"],
    keywords: ["github"],
  },
  linear: {
    name: "Linear",
    description:
      "Build bots for Linear issues with Chat SDK. Browse official and community adapters that support Linear integration.",
    adapterSlugs: ["linear"],
    keywords: ["linear"],
  },
  email: {
    name: "Email",
    description:
      "Build email bots with Chat SDK. Browse official and community adapters that support email integration.",
    adapterSlugs: ["resend"],
    keywords: ["email"],
  },
  webex: {
    name: "Webex",
    description:
      "Build bots for Webex with Chat SDK. Browse official and community adapters that support Webex integration.",
    adapterSlugs: ["webex"],
    keywords: ["webex"],
  },
  "google-chat": {
    name: "Google Chat",
    description:
      "Build bots for Google Chat with Chat SDK. Browse official and community adapters that support Google Chat integration.",
    adapterSlugs: ["google-chat"],
    keywords: ["google chat"],
  },
  liveblocks: {
    name: "Liveblocks",
    description:
      "Build bots for Liveblocks Comments with Chat SDK. Browse official and community adapters that support Liveblocks integration.",
    adapterSlugs: ["liveblocks"],
    keywords: ["liveblocks"],
  },
  signal: {
    name: "Signal",
    description:
      "Build bots for Signal with Chat SDK. Browse official and community adapters that support Signal integration.",
    adapterSlugs: ["signal"],
    keywords: ["signal"],
  },
  bluesky: {
    name: "Bluesky",
    description:
      "Build bots for Bluesky DMs with Chat SDK. Browse official and community adapters that support Bluesky integration.",
    adapterSlugs: ["zernio"],
    keywords: ["bluesky"],
  },
  reddit: {
    name: "Reddit",
    description:
      "Build bots for Reddit with Chat SDK. Browse official and community adapters that support Reddit integration.",
    adapterSlugs: ["zernio"],
    keywords: ["reddit"],
  },
  zalo: {
    name: "Zalo",
    description:
      "Build bots for Zalo with Chat SDK. Browse official and community adapters that support Zalo integration.",
    adapterSlugs: ["zalo"],
    keywords: ["zalo"],
  },
};

const getMessengerAdapters = (messengerSlug: string) => {
  const config = messengerConfig[messengerSlug];
  if (!config) {
    return null;
  }

  const matchedAdapters = adapters.filter((adapter) => {
    // Check if adapter slug matches
    if (config.adapterSlugs.includes(adapter.slug)) {
      return true;
    }

    // Check if adapter description contains keywords
    if (config.keywords) {
      const lowerDesc = adapter.description.toLowerCase();
      return config.keywords.some((keyword) =>
        lowerDesc.includes(keyword.toLowerCase())
      );
    }

    return false;
  });

  return {
    config,
    adapters: matchedAdapters,
  };
};

const MessengerPage = async ({
  params,
}: PageProps<"/[lang]/adapters/for/[messenger]">) => {
  const { messenger } = await params;
  const data = getMessengerAdapters(messenger);

  if (!data || data.adapters.length === 0) {
    notFound();
  }

  const { config, adapters: matchedAdapters } = data;

  // Categorize adapters
  const official = matchedAdapters.filter(
    (a) => !(a.community || a.vendorOfficial)
  );
  const vendorOfficial = matchedAdapters.filter((a) => a.vendorOfficial);
  const community = matchedAdapters.filter(
    (a) => a.community && !a.vendorOfficial
  );

  return (
    <div className="container mx-auto max-w-5xl">
      <section className="mt-(--fd-nav-height) space-y-4 px-4 pt-16 pb-8 sm:pt-24">
        <Link
          className="inline-flex items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
          href="/adapters"
        >
          <ArrowLeftIcon className="size-4" />
          All Adapters
        </Link>
        <h1 className="text-balance font-semibold text-[40px] leading-[1.1] tracking-tight sm:text-5xl">
          {config.name} Adapters
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground leading-relaxed">
          {config.description}
        </p>
      </section>
      <div className="grid gap-10 px-4 pb-16">
        {official.length > 0 ? (
          <section className="grid gap-6">
            <div className="grid gap-1">
              <h2 className="font-semibold text-lg tracking-tight">Official</h2>
              <p className="text-muted-foreground text-sm">
                Published under <code>@chat-adapter/*</code> and maintained by
                Vercel.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {official.map((adapter) => (
                <AdapterCard
                  href={`/adapters/${adapter.slug}`}
                  key={adapter.slug}
                  {...adapter}
                />
              ))}
            </div>
          </section>
        ) : null}

        {vendorOfficial.length > 0 ? (
          <section className="grid gap-6">
            <div className="grid gap-1">
              <h2 className="font-semibold text-lg tracking-tight">
                Vendor Official
              </h2>
              <p className="text-muted-foreground text-sm">
                Built and maintained by the platform vendor.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {vendorOfficial.map((adapter) => (
                <AdapterCard
                  badge="vendor-official"
                  href={`/adapters/${adapter.slug}`}
                  key={adapter.slug}
                  {...adapter}
                />
              ))}
            </div>
          </section>
        ) : null}

        {community.length > 0 ? (
          <section className="grid gap-6">
            <div className="grid gap-1">
              <h2 className="font-semibold text-lg tracking-tight">
                Community
              </h2>
              <p className="text-muted-foreground text-sm">
                Built by third-party developers.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {community.map((adapter) => (
                <AdapterCard
                  href={`/adapters/${adapter.slug}`}
                  key={adapter.slug}
                  {...adapter}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
};

export const generateStaticParams = () =>
  Object.keys(messengerConfig).map((messenger) => ({ messenger }));

export const generateMetadata = async ({
  params,
}: PageProps<"/[lang]/adapters/for/[messenger]">): Promise<Metadata> => {
  const { messenger } = await params;
  const data = getMessengerAdapters(messenger);

  if (!data) {
    return {};
  }

  return {
    title: `${data.config.name} Adapters`,
    description: data.config.description,
    twitter: {
      card: "summary_large_image",
    },
  };
};

export default MessengerPage;
