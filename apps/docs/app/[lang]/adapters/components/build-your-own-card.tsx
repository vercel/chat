import { PlusIcon } from "lucide-react";

interface BuildYourOwnCardProps {
  href?: string;
  label?: string;
}

export const BuildYourOwnCard = ({
  href = "/docs/contributing/building",
  label = "Build your own adapter",
}: BuildYourOwnCardProps) => (
  <a className="no-underline" href={href}>
    <div className="flex h-full min-h-[179px] items-center justify-center rounded-xl border border-dashed p-6 transition-colors hover:border-foreground/25 hover:bg-accent/50">
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <PlusIcon className="size-4" />
        {label}
      </div>
    </div>
  </a>
);
