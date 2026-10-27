import { cacheLife } from "next/cache";

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
  "use cache";
  cacheLife("hours");

  try {
    const res = await fetch(
      "https://api.npmjs.org/downloads/point/last-week/chat"
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
  "use cache";
  cacheLife("hours");

  try {
    const res = await fetch("https://api.github.com/repos/vercel/chat");
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
  "use cache";
  cacheLife("hours");

  try {
    const res = await fetch(
      "https://api.github.com/repos/vercel/chat/contributors?per_page=1&anon=true"
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
    <dl
      aria-label="Chat SDK community"
      className="mx-auto grid max-w-4xl grid-cols-2 gap-x-6 gap-y-10 py-12 text-center md:grid-cols-4 md:py-20"
    >
      {stats.map((stat) => (
        <div className="flex flex-col" key={stat.label}>
          <dt className="order-2 mt-2 text-gray-900 text-sm">{stat.label}</dt>
          <dd className="text-heading-40 lg:text-heading-48">{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
};
