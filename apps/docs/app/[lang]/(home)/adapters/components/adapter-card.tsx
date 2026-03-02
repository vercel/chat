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
  ioredis,
  linear,
  memory,
  redis,
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
  redis,
  ioredis,
  memory,
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
    <a className="no-underline" href={href}>
      <Card className="group h-full gap-0 overflow-hidden py-0 shadow-none transition-colors hover:bg-accent/50">
        <CardHeader className="flex flex-col gap-4 p-6!">
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
            {beta ? (
              <CardAction>
                <Badge className="shrink-0" variant="secondary">
                  Beta
                </Badge>
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
