import type { GeistdocsSourceBundle } from "@vercel/geistdocs/source";
import { Card, Cards } from "fumadocs-ui/components/card";
import { Heading } from "fumadocs-ui/components/heading";
import { type LoaderPage, selectReadMore } from "@/lib/read-more";

interface ReadMoreProps {
  page: LoaderPage;
  source: GeistdocsSourceBundle;
}

/**
 * "Read more" section rendered at the bottom of every docs page. Links are
 * picked by `selectReadMore` from the page's `related` and `prerequisites`
 * frontmatter, topped up with section siblings.
 */
export const ReadMore = ({ page, source }: ReadMoreProps) => {
  const pages = selectReadMore(source.source, page);
  if (pages.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="read-more">
      <Heading as="h2" id="read-more">
        Read more
      </Heading>
      <Cards>
        {pages.map((related) => (
          <Card
            description={related.data.description}
            href={related.url}
            key={related.url}
            title={related.data.title}
          />
        ))}
      </Cards>
    </section>
  );
};
