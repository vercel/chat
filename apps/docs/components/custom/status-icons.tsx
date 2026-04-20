import { IconCheckCircleFill } from "@/components/geistcn-fallbacks/geistcn-assets/icons/icon-check-circle-fill";
import { IconCrossCircleFill } from "@/components/geistcn-fallbacks/geistcn-assets/icons/icon-cross-circle-fill";
import { IconWarningFill } from "@/components/geistcn-fallbacks/geistcn-assets/icons/icon-warning-fill";

const wrapperClass = "inline-block align-text-bottom shrink-0";

export const Check = () => (
  <IconCheckCircleFill className={`${wrapperClass} text-green-900`} size={16} />
);

export const Cross = () => (
  <IconCrossCircleFill className={`${wrapperClass} text-red-900`} size={16} />
);

export const Warn = () => (
  <IconWarningFill className={`${wrapperClass} text-amber-700`} size={16} />
);
