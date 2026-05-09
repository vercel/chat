import { CodeBlock } from "./code-block";
import {
  CodeBlockTab,
  CodeBlockTabs,
  CodeBlockTabsList,
  CodeBlockTabsTrigger,
} from "./code-block-tabs";

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

export interface PackageInstallProps {
  package: string;
  dev?: boolean;
}

export const PackageInstall = ({
  package: pkg,
  dev = false,
}: PackageInstallProps) => (
  <CodeBlockTabs className="mb-6" defaultValue="pnpm">
    <CodeBlockTabsList>
      {PACKAGE_MANAGERS.map((manager) => (
        <CodeBlockTabsTrigger key={manager} value={manager}>
          {manager}
        </CodeBlockTabsTrigger>
      ))}
    </CodeBlockTabsList>
    {PACKAGE_MANAGERS.map((manager) => (
      <CodeBlockTab key={manager} value={manager}>
        <CodeBlock className="px-4">
          <code>{buildCommand(manager, pkg, dev)}</code>
        </CodeBlock>
      </CodeBlockTab>
    ))}
  </CodeBlockTabs>
);
