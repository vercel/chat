import Link from "next/link";
import { Button } from "@/components/ui/button";

export const Upsell = () => (
  <div className="group hidden w-full xl:block" data-testid="docs-upsell">
    <div className="relative flex flex-col gap-3 rounded-xl border bg-card p-4 text-muted-foreground text-sm">
      <span className="inline-flex font-semibold text-foreground text-xl leading-tight tracking-tighter">
        Deploy your chat app on Vercel
      </span>

      <p>
        Build a single chatbot that scales to Slack, Teams, GitHub, and beyond.
      </p>

      <div className="flex w-full flex-row items-end gap-2 pt-2">
        <Link
          className="w-full"
          href="https://vercel.com/signup?utm_source=chat-sdk_site&utm_medium=docs_card&utm_content=sign-up"
          rel="noopener noreferrer"
          target="_blank"
        >
          <Button className="w-full" size="default">
            Sign Up
          </Button>
        </Link>
      </div>
    </div>
  </div>
);
