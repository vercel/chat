import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface Resource {
  description: string;
  href: string;
  title: string;
  type: "guide" | "template";
}

const typeLabel: Record<Resource["type"], string> = {
  guide: "Guide",
  template: "Template",
};

export const ResourceCard = ({ title, description, href, type }: Resource) => {
  const isExternal = href.startsWith("http");

  return (
    <a
      className="no-underline"
      href={href}
      {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      <Card className="group h-full gap-0 overflow-hidden py-0 shadow-none transition-colors hover:bg-accent/50">
        <CardHeader className="flex h-full flex-col gap-3 p-6!">
          <Badge className="w-fit" variant="secondary">
            {typeLabel[type]}
          </Badge>
          <CardTitle className="text-balance font-medium leading-snug">
            {title}
          </CardTitle>
          <CardDescription className="line-clamp-2">
            {description}
          </CardDescription>
        </CardHeader>
      </Card>
    </a>
  );
};
