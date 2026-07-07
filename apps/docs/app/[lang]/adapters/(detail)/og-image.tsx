import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
// biome-ignore lint/performance/noNamespaceImport: "Required for Satori"
import * as logos from "@/lib/logos";

const LOGO_SIZE = 160;

const ADAPTER_LOGOS: Record<
  string,
  {
    component: (typeof logos)[keyof typeof logos];
    height: number;
    width: number;
  }
> = {
  github: { component: logos.github, width: LOGO_SIZE, height: LOGO_SIZE },
  slack: { component: logos.slack, width: LOGO_SIZE, height: LOGO_SIZE },
  teams: {
    component: logos.teams,
    width: LOGO_SIZE,
    height: Math.round(LOGO_SIZE * (2074 / 2229)),
  },
  linear: { component: logos.linear, width: LOGO_SIZE, height: LOGO_SIZE },
  gchat: {
    component: logos.gchat,
    width: Math.round(LOGO_SIZE * (311 / 320)),
    height: LOGO_SIZE,
  },
  discord: {
    component: logos.discord,
    width: LOGO_SIZE,
    height: Math.round(LOGO_SIZE * (620 / 800)),
  },
  telegram: {
    component: logos.telegram,
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
  redis: { component: logos.redis, width: LOGO_SIZE, height: LOGO_SIZE },
  ioredis: {
    component: logos.ioredis,
    width: LOGO_SIZE,
    height: Math.round(LOGO_SIZE * (87 / 91)),
  },
  memory: { component: logos.memory, width: LOGO_SIZE, height: LOGO_SIZE },
  postgres: {
    component: logos.postgres,
    width: Math.round(LOGO_SIZE * (576 / 594)),
    height: LOGO_SIZE,
  },
  whatsapp: {
    component: logos.whatsapp,
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
  twilio: {
    component: logos.twilio,
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
};

const FONTS_DIR = "app/[lang]/og/[...slug]";

export interface AdapterOgInput {
  description: string;
  logo?: string;
  title: string;
}

export const renderAdapterOg = async (input: AdapterOgInput) => {
  const { title, description, logo } = input;

  const regularFont = await readFile(
    join(process.cwd(), FONTS_DIR, "geist-sans-regular.ttf")
  );
  const semiboldFont = await readFile(
    join(process.cwd(), FONTS_DIR, "geist-sans-semibold.ttf")
  );
  const backgroundImage = await readFile(
    join(process.cwd(), FONTS_DIR, "background.png")
  );

  const backgroundImageData = backgroundImage.buffer.slice(
    backgroundImage.byteOffset,
    backgroundImage.byteOffset + backgroundImage.byteLength
  );

  const adapterLogo =
    logo && logo in ADAPTER_LOGOS ? ADAPTER_LOGOS[logo] : null;

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
          style={{ textWrap: "balance" }}
          tw="text-5xl font-medium text-white tracking-tight flex leading-[1.1] mb-4"
        >
          {title}
        </div>
        <div
          style={{ color: "#8B8B8B", lineHeight: "44px", textWrap: "balance" }}
          tw="text-[32px]"
        >
          {description}
        </div>
      </div>
      {adapterLogo ? (
        <div
          style={{ width: LOGO_SIZE, height: 628 }}
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
        { name: "Geist", data: regularFont, weight: 400 },
        { name: "Geist", data: semiboldFont, weight: 500 },
      ],
    }
  );
};
