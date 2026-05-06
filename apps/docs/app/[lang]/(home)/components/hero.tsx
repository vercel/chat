import type { ReactNode } from "react";

interface HeroProps {
  children: ReactNode;
  description: ReactNode;
  title: string;
}

export const Hero = ({ title, description, children }: HeroProps) => (
  <section className="mt-(--fd-nav-height) flex flex-col items-center justify-center gap-y-6 px-4 py-20 text-center sm:py-32">
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <h1 className="text-balance text-center font-semibold text-[40px]! leading-[1.1] tracking-tight sm:text-5xl! lg:font-semibold xl:text-6xl!">
        {title}
      </h1>
      <p className="mx-auto max-w-3xl text-balance text-muted-foreground leading-relaxed sm:max-w-2xl sm:text-xl">
        {description}
      </p>
    </div>
    {children}
  </section>
);
