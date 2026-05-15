"use client";

import Image from "next/image";
import { useTheme } from "next-themes";
import type { ComponentProps } from "react";

type ImageProps = ComponentProps<typeof Image>;

type ThemeAwareImageProps = Omit<ImageProps, "src"> & {
  src: {
    light: ImageProps["src"];
    dark: ImageProps["src"];
  };
};

export const ThemeAwareImage = ({ src, ...props }: ThemeAwareImageProps) => {
  const { resolvedTheme } = useTheme();

  return (
    <Image {...props} src={resolvedTheme === "dark" ? src.dark : src.light} />
  );
};
