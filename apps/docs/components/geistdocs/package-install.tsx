"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "fumadocs-ui/components/tabs.unstyled";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PACKAGE_MANAGERS = ["pnpm", "npm", "yarn", "bun"] as const;
type PackageManager = (typeof PACKAGE_MANAGERS)[number];

const buildCommand = (
  manager: PackageManager,
  pkg: string,
  dev: boolean
): string => {
  switch (manager) {
    case "pnpm":
      return `pnpm add ${dev ? "-D " : ""}${pkg}`;
    case "npm":
      return `npm install ${dev ? "--save-dev " : ""}${pkg}`;
    case "yarn":
      return `yarn add ${dev ? "-D " : ""}${pkg}`;
    case "bun":
      return `bun add ${dev ? "-d " : ""}${pkg}`;
    default:
      return pkg;
  }
};

interface SnippetProps {
  command: string;
}

const Snippet = ({ command }: SnippetProps) => {
  const [isCopied, setIsCopied] = useState(false);
  const Icon = isCopied ? CheckIcon : CopyIcon;

  const copyToClipboard = useCallback(async () => {
    if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
      toast.error("Clipboard API not available");
      return;
    }
    try {
      await navigator.clipboard.writeText(command);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(message);
    }
  }, [command]);

  return (
    <div className="flex items-center gap-3 bg-neutral-950 px-4 py-3 font-mono text-[13px] text-neutral-50">
      <span aria-hidden className="select-none text-neutral-500">
        $
      </span>
      <code className="flex-1 truncate bg-transparent p-0 text-neutral-50">
        {command}
      </code>
      <Button
        aria-label="Copy command"
        className="size-7 shrink-0 text-neutral-300 hover:bg-neutral-800 hover:text-neutral-50"
        onClick={copyToClipboard}
        size="icon"
        variant="ghost"
      >
        <Icon size={14} />
      </Button>
    </div>
  );
};

export interface PackageInstallProps {
  package: string;
  dev?: boolean;
}

export const PackageInstall = ({
  package: pkg,
  dev = false,
}: PackageInstallProps) => (
  <Tabs
    className="not-prose mb-6 overflow-hidden rounded-md border bg-card"
    defaultValue="pnpm"
  >
    <TabsList className="flex w-full gap-1 border-b bg-card px-2">
      {PACKAGE_MANAGERS.map((manager) => (
        <TabsTrigger
          className={cn(
            "group relative px-3 py-2 text-[15px] text-muted-foreground transition-colors",
            "hover:text-foreground data-[state=active]:text-foreground"
          )}
          key={manager}
          value={manager}
        >
          {manager}
          <span className="absolute inset-x-0 -bottom-px h-px bg-transparent group-data-[state=active]:bg-foreground" />
        </TabsTrigger>
      ))}
    </TabsList>
    {PACKAGE_MANAGERS.map((manager) => (
      <TabsContent key={manager} value={manager}>
        <Snippet command={buildCommand(manager, pkg, dev)} />
      </TabsContent>
    ))}
  </Tabs>
);
