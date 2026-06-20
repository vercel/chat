import type { ReactNode } from "react";

interface HeroProps {
  children: ReactNode;
  description: ReactNode;
  title: ReactNode;
}

export const Hero = ({ title, description, children }: HeroProps) => (
  <section className="mt-(--fd-nav-height) flex flex-col items-center justify-center gap-y-5 px-4 py-28 sm:py-48">
    <h1 className="max-w-5xl text-center text-heading-40 md:text-heading-48 lg:text-heading-64">
      {title}
    </h1>
    <p className="w-full text-center text-copy-16 text-gray-900 md:max-w-2xl md:text-copy-18 lg:text-copy-20">
      {description}
    </p>
    {children}
  </section>
);
