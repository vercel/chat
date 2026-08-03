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
    <dl className="grid grid-cols-12 gap-x-8 gap-y-10 py-10 lg:gap-x-12 lg:py-12">
      {stats.map((stat) => (
        <div
          className="col-span-6 sm:mx-auto min-[768px]:col-span-3"
          key={stat.label}
        >
          <dt className="text-gray-1000 text-heading-40 sm:text-heading-64">
            {stat.value}
          </dt>
          <dd className="whitespace-nowrap text-copy-16 text-gray-1000">
            {stat.label}
          </dd>
        </div>
      ))}
    </dl>
  );
};
