import { VerifiedIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  discord,
  gchat,
  github,
  linear,
  slack,
  teams,
  telegram,
} from "@/lib/logos";

const iconMap: Record<
  string,
  (props: React.ComponentProps<"svg">) => React.JSX.Element
> = {
  slack,
  teams,
  "google-chat": gchat,
  discord,
  github,
  linear,
  telegram,
};

interface AdapterCardProps {
  badge?: "official" | "vendor-official";
  beta?: boolean;
  description: string;
  href: string;
  icon?: string;
  name: string;
  packageName: string;
}

export const AdapterCard = ({
  name,
  description,
  href,
  packageName,
  icon,
  badge,
  beta,
}: AdapterCardProps) => {
  const Icon = icon ? iconMap[icon] : undefined;

  return (
    <a
      className="group flex flex-col gap-3 rounded-lg border bg-background p-5 transition-colors hover:bg-accent/50"
      href={href}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {Icon ? <Icon className="size-5" /> : null}
          <h3 className="font-medium tracking-tight">{name}</h3>
        </div>
        {badge ? (
          <Badge className="shrink-0" variant="secondary">
            <VerifiedIcon className="size-4 text-primary" />
            {badge === "official" ? "Official" : "Vendor official"}
          </Badge>
        ) : null}
        {beta ? (
          <Badge className="shrink-0" variant="secondary">
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
};
