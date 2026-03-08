import {
  SiInstagram,
  SiMessenger,
  SiSignal,
  SiWhatsapp,
  SiX,
} from "@icons-pack/react-simple-icons";
import { ExternalLinkIcon, VerifiedIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  discord,
  gchat,
  github,
  ioredis,
  linear,
  memory,
  postgres,
  redis,
  slack,
  teams,
  telegram,
} from "@/lib/logos";

const iconMap: Record<
  string,
  (props: React.ComponentProps<"svg">) => React.ReactNode
> = {
  slack,
  teams,
  "google-chat": gchat,
  discord,
  github,
  linear,
  telegram,
  redis,
  ioredis,
  postgres,
  memory,
  whatsapp: SiWhatsapp,
  instagram: SiInstagram,
  signal: SiSignal,
  x: SiX,
  messenger: SiMessenger,
};

const StatusBadge = ({
  comingSoon,
  beta,
}: {
  comingSoon?: boolean;
  beta?: boolean;
}) => {
  if (comingSoon) {
    return (
      <CardAction>
        <Badge className="shrink-0" variant="outline">
          Coming soon
        </Badge>
      </CardAction>
    );
  }

  if (beta) {
    return (
      <CardAction>
        <Badge className="shrink-0" variant="secondary">
          Beta
        </Badge>
      </CardAction>
    );
  }

  return null;
};

const FooterContent = ({
  comingSoon,
  packageName,
  prs,
}: {
  comingSoon?: boolean;
  packageName?: string;
  prs?: string[];
}) => {
  if (comingSoon && prs && prs.length > 0) {
    return (
      <span className="flex items-center gap-2 text-muted-foreground text-xs">
        <ExternalLinkIcon className="size-3" />
        {prs.length === 1 ? "1 open PR" : `${prs.length} open PRs`}
      </span>
    );
  }

  if (comingSoon) {
    return (
      <span className="text-muted-foreground text-xs">
        Submit a PR to contribute
      </span>
    );
  }

  return <code className="text-muted-foreground text-xs">{packageName}</code>;
};

interface AdapterCardProps {
  badge?: "official" | "vendor-official";
  beta?: boolean;
  comingSoon?: boolean;
  description: string;
  href: string;
  icon?: string;
  name: string;
  packageName?: string;
  prs?: string[];
}

export const AdapterCard = ({
  name,
  description,
  href,
  packageName,
  icon,
  badge,
  beta,
  comingSoon,
  prs,
}: AdapterCardProps) => {
  const Icon = icon ? iconMap[icon] : undefined;

  const content = (
    <Card
      className={`group h-full gap-0 overflow-hidden py-0 shadow-none transition-colors ${
        comingSoon ? "opacity-50" : "hover:bg-accent/50"
      }`}
    >
      <CardHeader className="flex h-full flex-col gap-4 p-6!">
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-2.5">
            {Icon ? <Icon className="size-5" /> : null}
            <CardTitle className="font-medium">{name}</CardTitle>
          </div>
          {badge ? (
            <CardAction>
              <Badge className="shrink-0" variant="secondary">
                <VerifiedIcon className="size-4 text-primary" />
                {badge === "official" ? "Official" : "Vendor official"}
              </Badge>
            </CardAction>
          ) : null}
          <StatusBadge beta={beta} comingSoon={comingSoon} />
        </div>
        <CardDescription className="col-span-2 line-clamp-2">
          {description}
        </CardDescription>
      </CardHeader>
      <CardFooter className="border-t bg-sidebar px-6! py-4! transition-colors group-hover:bg-secondary">
        <FooterContent
          comingSoon={comingSoon}
          packageName={packageName}
          prs={prs}
        />
      </CardFooter>
    </Card>
  );

  if (comingSoon) {
    if (prs && prs.length > 0) {
      return (
        <a
          className="no-underline"
          href={prs[0]}
          rel="noopener noreferrer"
          target="_blank"
        >
          {content}
        </a>
      );
    }

    return <div>{content}</div>;
  }

  return (
    <a className="no-underline" href={href}>
      {content}
    </a>
  );
};
