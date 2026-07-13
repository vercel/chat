import { defineI18n } from "fumadocs-core/i18n";
import { translations } from "@/geistdocs";

export const i18n = defineI18n({
  defaultLanguage: "en",
  languages: Object.keys(translations),
  hideLocale: "default-locale",
});
