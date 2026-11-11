import { CodeShowcase } from "./code-showcase";

export const CodeSection = () => (
  <section
    aria-labelledby="home-code"
    className="grid grid-cols-1 gap-10 py-12 md:py-20 lg:grid-cols-12 lg:gap-8"
  >
    <h2 className="sr-only" id="home-code">
      Explore Chat SDK
    </h2>
    <CodeShowcase />
  </section>
);
