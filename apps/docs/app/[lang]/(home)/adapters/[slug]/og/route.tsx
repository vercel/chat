import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import adapters from "@/adapters.json";
// biome-ignore lint/performance/noNamespaceImport: "Required for Satori"
import * as logos from "@/lib/logos";

const logoSize = 160;

const adapterLogos: Record<
  string,
  {
    component: (typeof logos)[keyof typeof logos];
    width: number;
    height: number;
  }
> = {
  github: { component: logos.github, width: logoSize, height: logoSize },
  slack: { component: logos.slack, width: logoSize, height: logoSize },
  teams: {
    component: logos.teams,
    width: logoSize,
    height: Math.round(logoSize * (2074 / 2229)),
  },
  linear: { component: logos.linear, width: logoSize, height: logoSize },
  "google-chat": {
    component: logos.gchat,
    width: Math.round(logoSize * (311 / 320)),
    height: logoSize,
  },
  discord: {
    component: logos.discord,
    width: logoSize,
    height: Math.round(logoSize * (620 / 800)),
  },
  telegram: { component: logos.telegram, width: logoSize, height: logoSize },
  redis: { component: logos.redis, width: logoSize, height: logoSize },
  ioredis: {
    component: logos.ioredis,
    width: logoSize,
    height: Math.round(logoSize * (87 / 91)),
  },
  memory: { component: logos.memory, width: logoSize, height: logoSize },
  postgres: {
    component: logos.postgres,
    width: Math.round(logoSize * (576 / 594)),
    height: logoSize,
  },
  whatsapp: { component: logos.whatsapp, width: logoSize, height: logoSize },
};

const fontsDir = "app/[lang]/og/[...slug]";

export const GET = async (
  _request: NextRequest,
  { params }: RouteContext<"/[lang]/adapters/[slug]/og">
) => {
  const { slug } = await params;
  const adapter = adapters.find((a) => a.slug === slug);

  if (!adapter) {
    return new Response("Not found", { status: 404 });
  }

  const { name: title, description, icon } = adapter;

  const regularFont = await readFile(
    join(process.cwd(), fontsDir, "geist-sans-regular.ttf")
  );

  const semiboldFont = await readFile(
    join(process.cwd(), fontsDir, "geist-sans-semibold.ttf")
  );

  const backgroundImage = await readFile(
    join(process.cwd(), fontsDir, "background.png")
  );

  const backgroundImageData = backgroundImage.buffer.slice(
    backgroundImage.byteOffset,
    backgroundImage.byteOffset + backgroundImage.byteLength
  );

  const adapterLogo = icon && icon in adapterLogos ? adapterLogos[icon] : null;

  return new ImageResponse(
    <div style={{ fontFamily: "Geist" }} tw="flex h-full w-full bg-black">
      {/** biome-ignore lint/performance/noImgElement: "Required for Satori" */}
      <img
        alt="Vercel OpenGraph Background"
        height={628}
        src={backgroundImageData as never}
        width={1200}
      />
      <div tw="flex flex-col absolute h-full w-[750px] justify-center left-[50px] pr-[50px] pt-[116px] pb-[86px]">
        <div
          style={{
            textWrap: "balance",
          }}
          tw="text-5xl font-medium text-white tracking-tight flex leading-[1.1] mb-4"
        >
          {title}
        </div>
        <div
          style={{
            color: "#8B8B8B",
            lineHeight: "44px",
            textWrap: "balance",
          }}
          tw="text-[32px]"
        >
          {description}
        </div>
      </div>
      {adapterLogo ? (
        <div
          style={{ width: logoSize, height: 628 }}
          tw="absolute right-[80px] top-0 bottom-0 flex items-center justify-center"
        >
          <adapterLogo.component
            height={adapterLogo.height}
            width={adapterLogo.width}
          />
        </div>
      ) : null}
    </div>,
    {
      width: 1200,
      height: 628,
      fonts: [
        {
          name: "Geist",
          data: regularFont,
          weight: 400,
        },
        {
          name: "Geist",
          data: semiboldFont,
          weight: 500,
        },
      ],
    }
  );
};

export const generateStaticParams = () =>
  adapters
    .filter((adapter) => "readme" in adapter)
    .map((adapter) => ({ slug: adapter.slug }));
