import type { CSSProperties } from "react";
import { codeToTokens } from "shiki";
import { cn } from "@/lib/utils";

interface TemplatesProps {
  data: {
    title: string;
    description: string;
    link: string;
    code: string;
  }[];
  description: string;
  title: string;
}

const parseRootStyle = (rootStyle: string): Record<string, string> => {
  const style: Record<string, string> = {};
  for (const decl of rootStyle.split(";")) {
    const idx = decl.indexOf(":");
    if (idx > 0) {
      const prop = decl.slice(0, idx).trim();
      const val = decl.slice(idx + 1).trim();
      if (prop && val) {
        style[prop] = val;
      }
    }
  }
  return style;
};

const CodeBlock = async ({ code }: { code: string }) => {
  const { tokens, rootStyle } = await codeToTokens(code, {
    lang: "tsx",
    themes: {
      light: "github-light",
      dark: "github-dark",
    },
    defaultColor: false,
  });

  const preStyle: Record<string, string> = {};

  if (rootStyle) {
    Object.assign(preStyle, parseRootStyle(rootStyle));
  }

  return (
    <pre
      className="overflow-hidden bg-background p-3 text-xs leading-relaxed"
      style={
        {
          "--sdm-bg": "#fff",
          ...preStyle,
        } as CSSProperties
      }
    >
      <code className="grid min-w-max">
        {tokens.map((line, lineIndex) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static token array from shiki
          <span className="line" key={lineIndex}>
            {line.length > 0
              ? line.map((token, tokenIndex) => {
                  const tokenStyle: Record<string, string> = {};

                  if (token.htmlStyle) {
                    for (const [key, value] of Object.entries(
                      token.htmlStyle
                    )) {
                      if (key === "color" || key === "--shiki-light") {
                        tokenStyle["--sdm-c"] = value;
                      } else if (
                        key === "background-color" ||
                        key === "--shiki-light-bg"
                      ) {
                        tokenStyle["--sdm-tbg"] = value;
                      } else {
                        tokenStyle[key] = value;
                      }
                    }
                  }

                  const hasBg = Boolean(tokenStyle["--sdm-tbg"]);

                  return (
                    <span
                      className={cn(
                        "text-[var(--sdm-c,inherit)]",
                        "dark:text-[var(--shiki-dark,var(--sdm-c,inherit))]",
                        hasBg && "bg-[var(--sdm-tbg)]",
                        hasBg &&
                          "dark:bg-[var(--shiki-dark-bg,var(--sdm-tbg))]"
                      )}
                      // biome-ignore lint/suspicious/noArrayIndexKey: static token array from shiki
                      key={tokenIndex}
                      style={tokenStyle as CSSProperties}
                    >
                      {token.content}
                    </span>
                  );
                })
              : "\n"}
          </span>
        ))}
      </code>
    </pre>
  );
};

export const Templates = ({ title, description, data }: TemplatesProps) => (
  <div className="grid gap-12 p-8 px-4 py-8 sm:p-12 sm:px-12 sm:py-12">
    <div className="grid max-w-3xl gap-2 text-balance">
      <h2 className="font-semibold text-xl tracking-tight sm:text-2xl md:text-3xl lg:text-[40px]">
        {title}
      </h2>
      <p className="text-balance text-lg text-muted-foreground">
        {description}
      </p>
    </div>
    <div className="grid gap-8 md:grid-cols-3">
      {data.map((item) => (
        <a
          className="group flex-col overflow-hidden rounded-lg border bg-background p-4"
          href={item.link}
          key={item.title}
        >
          <h3 className="font-medium tracking-tight">{item.title}</h3>
          <p className="line-clamp-2 text-muted-foreground text-sm">
            {item.description}
          </p>
          <div
            className={cn(
              "mt-4 -mb-8 ml-4 -mr-8 -rotate-3 aspect-video overflow-hidden rounded-md border",
              "transition-transform duration-300 group-hover:-rotate-1 group-hover:scale-105"
            )}
          >
            <CodeBlock code={item.code} />
          </div>
        </a>
      ))}
    </div>
  </div>
);
