import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Geist typography utilities share the `text-` prefix with color utilities
// (e.g. text-gray-900). tailwind-merge only knows the default theme, so it
// mistakes these size tokens for colors and drops them when both are present.
// Register them as font-size members so merges keep size and color
// independent. Mirrors the `cn` inside @vercel/geistdocs, which isn't exported.
const GEIST_FONT_SIZES = [
  "button-12",
  "button-14",
  "button-16",
  "copy-13",
  "copy-13-mono",
  "copy-14",
  "copy-14-mono",
  "copy-16",
  "copy-18",
  "copy-20",
  "copy-24",
  "heading-14",
  "heading-16",
  "heading-20",
  "heading-24",
  "heading-32",
  "heading-40",
  "heading-48",
  "heading-56",
  "heading-64",
  "heading-72",
  "label-12",
  "label-12-mono",
  "label-13",
  "label-13-mono",
  "label-14",
  "label-14-mono",
  "label-16",
  "label-16-mono",
  "label-18",
  "label-20",
]

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: GEIST_FONT_SIZES }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
