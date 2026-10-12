import type { CatalogAdapter, CommunityAdapter } from "../types";
import { baileys } from "./community/baileys";
import { blooio } from "./community/blooio";
import { cloudflareDo } from "./community/cloudflare-do";
import { line } from "./community/line";
import { mattermost } from "./community/mattermost";
import { mysql } from "./community/mysql";
import { qq } from "./community/qq";
import { webex } from "./community/webex";
import { wecom } from "./community/wecom";
import { weixin } from "./community/weixin";
import { zaileys } from "./community/zaileys";
import { zalo } from "./community/zalo";
import { discord } from "./official/discord";
import { gchat } from "./official/gchat";
import { github } from "./official/github";
import { gmail } from "./official/gmail";
import { instagram } from "./official/instagram";
import { ioredis } from "./official/ioredis";
import { linear } from "./official/linear";
import { memory } from "./official/memory";
import { messenger } from "./official/messenger";
import { notion } from "./official/notion";
import { postgres } from "./official/postgres";
import { redis } from "./official/redis";
import { slack } from "./official/slack";
import { teams } from "./official/teams";
import { telegram } from "./official/telegram";
import { twilio } from "./official/twilio";
import { twitch } from "./official/twitch";
import { web } from "./official/web";
import { whatsapp } from "./official/whatsapp";
import { x } from "./official/x";
import { xchat } from "./official/xchat";
import { agentphone } from "./vendor-official/agentphone";
import { cloudflareAgents } from "./vendor-official/cloudflare-agents";
import { dial } from "./vendor-official/dial";
import { kapso } from "./vendor-official/kapso";
import { lark } from "./vendor-official/lark";
import { linq } from "./vendor-official/linq";
import { liveblocks } from "./vendor-official/liveblocks";
import { matrix } from "./vendor-official/matrix";
import { novu } from "./vendor-official/novu";
import { photon } from "./vendor-official/photon";
import { resend } from "./vendor-official/resend";
import { sendblue } from "./vendor-official/sendblue";
import { velt } from "./vendor-official/velt";
import { zernio } from "./vendor-official/zernio";

/**
 * Official and vendor-official adapters keyed by slug, in the order
 * chat-sdk.dev lists them.
 */
export const ADAPTERS = {
  slack,
  teams,
  gchat,
  gmail,
  discord,
  github,
  linear,
  notion,
  telegram,
  whatsapp,
  twilio,
  x,
  xchat,
  messenger,
  instagram,
  twitch,
  web,
  redis,
  ioredis,
  postgres,
  memory,
  "cloudflare-agents": cloudflareAgents,
  liveblocks,
  resend,
  sendblue,
  zernio,
  matrix,
  agentphone,
  lark,
  velt,
  kapso,
  novu,
  linq,
  photon,
  dial,
} as const satisfies Record<string, CatalogAdapter>;

/**
 * Community adapters listed on chat-sdk.dev, keyed by slug, in listing order.
 */
export const COMMUNITY_ADAPTERS = {
  "cloudflare-do": cloudflareDo,
  mysql,
  webex,
  baileys,
  zaileys,
  blooio,
  zalo,
  qq,
  wecom,
  mattermost,
  weixin,
  line,
} as const satisfies Record<string, CommunityAdapter>;
