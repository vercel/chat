import Link from "next/link";
import {
  type AdapterFeatureValue,
  PLATFORM_FEATURE_CATEGORIES,
  STATE_FEATURE_CATEGORIES,
} from "@/lib/adapter-features";
import { adaptersSource } from "@/lib/geistdocs/adapters-source";
import { i18n } from "@/lib/geistdocs/i18n";
import { cn } from "@/lib/utils";
import { FeatureCell } from "./feature-cell";

interface AdapterFrontmatter {
  community?: boolean;
  features?: Record<string, AdapterFeatureValue>;
  slug: string;
  title: string;
  type: "platform" | "state";
}

interface AdapterEntry {
  features: Record<string, AdapterFeatureValue> | undefined;
  href: string;
  name: string;
  slug: string;
}

const collectAdapters = (type: "platform" | "state"): AdapterEntry[] => {
  const pages = adaptersSource.getPages(i18n.defaultLanguage);
  return pages
    .map((page) => ({ url: page.url, data: page.data as AdapterFrontmatter }))
    .filter(({ data }) => data.type === type)
    .filter(({ data }) => !data.community)
    .map(({ url, data }) => ({
      name: data.title,
      slug: data.slug,
      href: url,
      features: data.features,
    }));
};

interface GlobalFeatureMatrixProps {
  type?: "platform" | "state";
}

export const GlobalFeatureMatrix = ({
  type = "platform",
}: GlobalFeatureMatrixProps) => {
  const adapters = collectAdapters(type);
  const categories =
    type === "platform"
      ? PLATFORM_FEATURE_CATEGORIES
      : STATE_FEATURE_CATEGORIES;

  if (adapters.length === 0) {
    return null;
  }

  return (
    <div className="not-prose mb-10 grid gap-10">
      {categories.map((category) => (
        <section key={category.id}>
          <h3 className="mb-3 font-medium text-base tracking-tight">
            {category.label}
          </h3>
          <div className="overflow-x-auto rounded-sm border">
            <table className="w-full text-sm">
              <thead className="bg-sidebar text-muted-foreground">
                <tr>
                  <th className="sticky left-0 z-10 bg-sidebar px-4 py-2 text-left font-medium">
                    Feature
                  </th>
                  {adapters.map((adapter) => (
                    <th
                      className="px-4 py-2 text-left font-medium"
                      key={adapter.slug}
                    >
                      <Link
                        className="font-normal text-primary no-underline"
                        href={adapter.href}
                      >
                        {adapter.name}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {category.features.map((feature, rowIndex) => (
                  <tr
                    className={cn(
                      rowIndex === category.features.length - 1
                        ? ""
                        : "border-b"
                    )}
                    key={feature.key}
                  >
                    <th className="sticky left-0 bg-background px-4 py-2 text-left font-normal">
                      {feature.label}
                    </th>
                    {adapters.map((adapter) => (
                      <td className="px-4 py-2" key={adapter.slug}>
                        <FeatureCell value={adapter.features?.[feature.key]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
};
