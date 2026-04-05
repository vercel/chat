import type { Metadata } from "next";
import adapters from "@/adapters.json";
import { AdaptersGrid } from "./components/adapters-grid";

export const metadata: Metadata = {
  title: "Adapters",
  description:
    "Browse official and community adapters for Chat SDK. Connect your bot to Slack, Teams, Discord, and more.",
  twitter: {
    card: "summary_large_image",
  },
};

const AdaptersPage = () => (
  <div className="container mx-auto max-w-5xl">
    <section className="mt-(--fd-nav-height) space-y-4 px-4 pt-16 pb-8 sm:pt-24">
      <h1 className="text-balance font-semibold text-[40px] leading-[1.1] tracking-tight sm:text-5xl">
        Adapters
      </h1>
      <p className="max-w-2xl text-lg text-muted-foreground leading-relaxed">
        Browse official and community-built adapters to connect your bot to any
        platform. Looking for a specific messenger? Check out{" "}
        <a
          className="text-foreground underline"
          href="/adapters/messenger/imessage"
        >
          iMessage
        </a>
        ,{" "}
        <a
          className="text-foreground underline"
          href="/adapters/messenger/whatsapp"
        >
          WhatsApp
        </a>
        ,{" "}
        <a
          className="text-foreground underline"
          href="/adapters/messenger/telegram"
        >
          Telegram
        </a>
        , and{" "}
        <a
          className="text-foreground underline"
          href="/adapters/messenger/slack"
        >
          more
        </a>
        .
      </p>
    </section>
    <div className="grid gap-10 px-4 pb-16">
      <AdaptersGrid adapters={adapters} />
    </div>
  </div>
);

export default AdaptersPage;
