import { highlightCode } from "@/lib/highlight-code";
import { CARD_CODE, PLATFORMS } from "../data/hero-demo";
import { DemoClient } from "./demo-client";

export const Demo = async () => {
  const tokens = await highlightCode(CARD_CODE, "tsx");

  return <DemoClient platforms={[...PLATFORMS]} tokens={tokens} />;
};
