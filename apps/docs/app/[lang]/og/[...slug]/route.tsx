import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { getPageImage, source } from "@/lib/geistdocs/source";
import * as logos from "@/lib/logos";

const logoSize = 160;

const adapterLogos: Record<
  string,
  { component: (typeof logos)[keyof typeof logos]; width: number; height: number }
> = {
  github: { component: logos.github, width: logoSize, height: logoSize }, // 1024x1024
  slack: { component: logos.slack, width: logoSize, height: logoSize }, // 126x126
  teams: { component: logos.teams, width: logoSize, height: Math.round(logoSize * (2074 / 2229)) }, // 2229x2074
  linear: { component: logos.linear, width: logoSize, height: logoSize }, // 200x200
  gchat: { component: logos.gchat, width: Math.round(logoSize * (311 / 320)), height: logoSize }, // 311x320
  discord: { component: logos.discord, width: logoSize, height: Math.round(logoSize * (620 / 800)) }, // 800x620
  telegram: { component: logos.telegram, width: logoSize, height: logoSize }, // 240x240
};

export const GET = async (
  _request: NextRequest,
  { params }: RouteContext<"/[lang]/og/[...slug]">
) => {
  const { slug, lang } = await params;
  const page = source.getPage(slug.slice(0, -1), lang);

  if (!page) {
    return new Response("Not found", { status: 404 });
  }

  const { title, description } = page.data;

  const regularFont = await readFile(
    join(process.cwd(), "app/[lang]/og/[...slug]/geist-sans-regular.ttf")
  );

  const semiboldFont = await readFile(
    join(process.cwd(), "app/[lang]/og/[...slug]/geist-sans-semibold.ttf")
  );

  const backgroundImage = await readFile(
    join(process.cwd(), "app/[lang]/og/[...slug]/background.png")
  );

  const backgroundImageData = backgroundImage.buffer.slice(
    backgroundImage.byteOffset,
    backgroundImage.byteOffset + backgroundImage.byteLength
  );

  const isAdapterPage =
    slug.length >= 3 && slug[0] === "adapters" && slug[1] in adapterLogos;
  const adapterLogo = isAdapterPage ? adapterLogos[slug[1]] : null;

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
          tw="absolute right-[80px] top-0 bottom-0 flex items-center justify-center"
          style={{ width: logoSize, height: 628 }}
        >
          <adapterLogo.component
            width={adapterLogo.width}
            height={adapterLogo.height}
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

export const generateStaticParams = async ({
  params,
}: RouteContext<"/[lang]/og/[...slug]">) => {
  const { lang } = await params;

  return source.getPages(lang).map((page) => ({
    lang: page.locale,
    slug: getPageImage(page).segments,
  }));
};
