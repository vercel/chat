import { VerifiedIcon } from "lucide-react";
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
  instagram,
  ioredis,
  linear,
  memory,
  messenger,
  notion,
  postgres,
  redis,
  slack,
  teams,
  telegram,
  twilio,
  web,
  whatsapp,
  x,
  xchat,
} from "@/lib/logos";

const iconMap: Record<
  string,
  (props: React.ComponentProps<"svg">) => React.ReactNode
> = {
  slack,
  teams,
  gchat,
  discord,
  github,
  instagram,
  web,
  linear,
  telegram,
  redis,
  ioredis,
  postgres,
  memory,
  whatsapp,
  twilio,
  messenger,
  notion,
  x,
  xchat,
};

interface AdapterCardProps {
  badge?: "official" | "vendor-official";
  beta?: boolean;
  description: string;
  href: string;
  icon?: string;
  name: string;
  packageName?: string;
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
    <a className="no-underline" href={href}>
      <Card className="group h-full gap-0 overflow-hidden py-0 shadow-none transition-colors hover:bg-accent/50">
        <CardHeader className="flex h-full flex-col gap-4 p-6!">
          <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 items-center gap-2.5">
              {Icon ? <Icon className="size-5 shrink-0" /> : null}
              <CardTitle className="break-words font-medium">{name}</CardTitle>
            </div>
            {badge ? (
              <CardAction className="shrink-0">
                <Badge variant="secondary">
                  <VerifiedIcon className="size-4 text-primary" />
                  {badge === "official" ? "Official" : "Vendor official"}
                </Badge>
              </CardAction>
            ) : null}
            {beta ? (
              <CardAction className="shrink-0">
                <Badge variant="secondary">Beta</Badge>
              </CardAction>
            ) : null}
          </div>
          <CardDescription className="col-span-2 line-clamp-2">
            {description}
          </CardDescription>
        </CardHeader>
        <CardFooter className="border-t bg-sidebar px-6! py-4! transition-colors group-hover:bg-secondary">
          <code className="text-muted-foreground text-xs">{packageName}</code>
        </CardFooter>
      </Card>
    </a>
  );
};
