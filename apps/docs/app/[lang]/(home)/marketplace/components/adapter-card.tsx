import { Badge } from "@/components/ui/badge";
import { VerifiedIcon } from "lucide-react";

interface AdapterCardProps {
  name: string;
  description: string;
  href: string;
  packageName: string;
  badge?: "vercel" | "verified";
  beta?: boolean;
}

export const AdapterCard = ({
  name,
  description,
  href,
  packageName,
  badge,
  beta,
}: AdapterCardProps) => (
  <a
    href={href}
    className="group flex flex-col gap-3 rounded-lg border bg-background p-5 transition-colors hover:bg-accent/50"
  >
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-center gap-2.5">
        <h3 className="font-medium tracking-tight">{name}</h3>
      </div>
      {badge ? (
        <Badge variant="secondary" className="shrink-0">
          <VerifiedIcon className="size-4 text-primary" />
          {badge === "vercel" ? "Vercel" : "Verified"}
        </Badge>
      ) : null}
      {beta ? (
        <Badge variant="secondary" className="shrink-0 bg-pink-500 text-white">
          Beta
        </Badge>
      ) : null}
    </div>
    <p className="line-clamp-2 text-muted-foreground text-sm">
      {description}
    </p>
    <code className="text-muted-foreground text-xs">{packageName}</code>
  </a>
);