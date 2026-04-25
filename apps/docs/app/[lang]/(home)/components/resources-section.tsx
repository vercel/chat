import DynamicLink from "fumadocs-core/dynamic-link";
import { BookOpenIcon, PlugIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export const ResourcesSection = () => (
  <section className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
    <div className="grid gap-6 px-4 py-10 sm:px-12 sm:py-12">
      <div className="grid gap-3">
        <div className="flex size-10 items-center justify-center rounded-md border bg-card text-muted-foreground">
          <BookOpenIcon className="size-5" />
        </div>
        <h2 className="font-semibold text-xl tracking-tight sm:text-2xl">
          Resources
        </h2>
        <p className="text-muted-foreground">
          Step-by-step guides and starter templates to help you design, build,
          and ship faster.
        </p>
      </div>
      <Button asChild className="w-fit" size="lg" variant="outline">
        <DynamicLink href="/[lang]/resources">Browse resources</DynamicLink>
      </Button>
    </div>
    <div className="grid gap-6 px-4 py-10 sm:px-12 sm:py-12">
      <div className="grid gap-3">
        <div className="flex size-10 items-center justify-center rounded-md border bg-card text-muted-foreground">
          <PlugIcon className="size-5" />
        </div>
        <h2 className="font-semibold text-xl tracking-tight sm:text-2xl">
          Adapters
        </h2>
        <p className="text-muted-foreground">
          Connect to any chat platform with official and community-built
          adapters in minutes.
        </p>
      </div>
      <Button asChild className="w-fit" size="lg" variant="outline">
        <DynamicLink href="/[lang]/adapters">Browse adapters</DynamicLink>
      </Button>
    </div>
  </section>
);
