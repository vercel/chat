import { CommandTabs } from "./package-install";

export interface CreateChatSdkProps {
  /** Space-separated adapter slugs passed to `--adapter`, e.g. `"slack memory"`. */
  adapters: string;
  /** Add `--connect` to scaffold Vercel Connect wiring. */
  connect?: boolean;
  /** Project name. Defaults to `my-bot`. */
  name?: string;
}

/**
 * `create-chat-sdk` scaffold command with one tab per package manager.
 *
 * npm needs the `--` separator so flags reach the CLI instead of npm itself.
 */
export const CreateChatSdk = ({
  adapters,
  connect = false,
  name = "my-bot",
}: CreateChatSdkProps) => {
  const args = `${name} --adapter ${adapters}${connect ? " --connect" : ""} -y`;

  return (
    <CommandTabs
      commands={{
        pnpm: `pnpm create chat-sdk@latest ${args}`,
        npm: `npm create chat-sdk@latest -- ${args}`,
        yarn: `yarn create chat-sdk ${args}`,
        bun: `bunx create-chat-sdk@latest ${args}`,
      }}
    />
  );
};
