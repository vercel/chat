import { Heading } from "fumadocs-ui/components/heading";
import {
  type AdapterPage,
  adaptersSource,
} from "@/lib/geistdocs/adapters-source";
import { collectRuns, rotateAfter } from "@/lib/read-more";
import { AdapterCard } from "./adapter-card";

const CARD_COUNT = 4;
const OFFICIAL_PREFIX = "/adapters/official/";

interface AdapterCardData {
  logo?: string;
  packageName?: string;
}

/**
 * Picks the official adapters to feature: same-type adapters first (the
 * official meta.json separators split platform and state into their own
 * runs), rotated after the current adapter, then the other official group.
 * Vendor-official and community adapters are never included.
 */
const selectMoreAdapters = (page: AdapterPage): AdapterPage[] => {
  const lang = page.locale;
  const byUrl = new Map<string, AdapterPage>();
  for (const candidate of adaptersSource.getPages(lang)) {
    if (candidate.url.startsWith(OFFICIAL_PREFIX)) {
      byUrl.set(candidate.url, candidate);
    }
  }

  const runs = collectRuns(adaptersSource.getPageTree(lang)).filter((run) =>
    run.some((url) => url.startsWith(OFFICIAL_PREFIX))
  );
  const sameType = runs.find((run) => run.includes(page.url)) ?? [];
  const otherRuns = runs.filter((run) => run !== sameType).flat();

  const selected: AdapterPage[] = [];
  for (const url of [...rotateAfter(sameType, page.url), ...otherRuns]) {
    if (selected.length >= CARD_COUNT) {
      break;
    }
    const candidate = byUrl.get(url);
    if (candidate && candidate.url !== page.url) {
      selected.push(candidate);
    }
  }
  return selected;
};

/** "More adapters" section rendered at the bottom of official adapter pages. */
export const MoreAdapters = ({ page }: { page: AdapterPage }) => {
  const picks = selectMoreAdapters(page);
  if (picks.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="more-adapters">
      <Heading as="h2" id="more-adapters">
        More adapters
      </Heading>
      <div className="not-prose grid gap-4 sm:grid-cols-2">
        {picks.map((adapter) => {
          const data = adapter.data as unknown as AdapterCardData;
          return (
            <AdapterCard
              description={adapter.data.description ?? ""}
              href={adapter.url}
              icon={data.logo}
              key={adapter.url}
              name={adapter.data.title}
              packageName={data.packageName}
            />
          );
        })}
      </div>
    </section>
  );
};
