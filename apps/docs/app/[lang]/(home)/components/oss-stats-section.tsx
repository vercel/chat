import { cn } from "@/lib/utils";

const CONTRIBUTORS_LINK_REGEX = /page=(\d+)>;\s*rel="last"/;

const FALLBACK = {
  downloads: "5K",
  stars: "1.2K",
  contributors: "20+",
  adapters: "15+",
};

const formatNumber = (n: number): string => {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return m % 1 === 0 ? `${m}M` : `${Number.parseFloat(m.toFixed(1))}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return k % 1 === 0 ? `${k}K` : `${Number.parseFloat(k.toFixed(1))}K`;
  }
  return `${n}`;
};

const fetchDownloads = async (): Promise<string> => {
  try {
    const res = await fetch(
      "https://api.npmjs.org/downloads/point/last-week/chat",
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) {
      return FALLBACK.downloads;
    }
    const data = (await res.json()) as { downloads: number };
    return formatNumber(data.downloads);
  } catch {
    return FALLBACK.downloads;
  }
};

const fetchStars = async (): Promise<string> => {
  try {
    const res = await fetch("https://api.github.com/repos/vercel/chat", {
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      return FALLBACK.stars;
    }
    const data = (await res.json()) as { stargazers_count: number };
    return formatNumber(data.stargazers_count);
  } catch {
    return FALLBACK.stars;
  }
};

const fetchContributors = async (): Promise<string> => {
  try {
    const res = await fetch(
      "https://api.github.com/repos/vercel/chat/contributors?per_page=1&anon=true",
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) {
      return FALLBACK.contributors;
    }
    const link = res.headers.get("link");
    if (!link) {
      return FALLBACK.contributors;
    }
    const match = link.match(CONTRIBUTORS_LINK_REGEX);
    if (!match) {
      return FALLBACK.contributors;
    }
    return `${formatNumber(Number(match[1]))}+`;
  } catch {
    return FALLBACK.contributors;
  }
};

export const OssStatsSection = async () => {
  const [downloads, stars, contributors] = await Promise.all([
    fetchDownloads(),
    fetchStars(),
    fetchContributors(),
  ]);

  const stats = [
    { value: downloads, label: "Weekly downloads" },
    { value: stars, label: "GitHub stars" },
    { value: contributors, label: "Contributors" },
    { value: FALLBACK.adapters, label: "Adapters" },
  ];

  return (
    <dl className="grid grid-cols-2 md:grid-cols-4">
      {stats.map((stat, i) => (
        <div
          className={cn(
            "flex flex-col gap-1.5 px-6 py-10 sm:px-10 sm:py-12",
            i === 1 && "border-l",
            i === 2 && "border-t md:border-t-0 md:border-l",
            i === 3 && "border-t border-l md:border-t-0"
          )}
          key={stat.label}
        >
          <dt className="font-semibold text-3xl tracking-tight sm:text-4xl">
            {stat.value}
          </dt>
          <dd className="font-mono text-muted-foreground text-sm">
            {stat.label}
          </dd>
        </div>
      ))}
    </dl>
  );
};
