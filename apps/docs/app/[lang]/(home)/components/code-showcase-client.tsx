"use client";

import DynamicLink from "fumadocs-core/dynamic-link";
import { Fragment, useId, useState } from "react";
import type { ThemedToken } from "shiki";
import { Button } from "@/components/ui/button";
import { SlidingTabs } from "@/components/ui/sliding-tabs";
import { cn } from "@/lib/utils";
import type {
  CodeExampleGroup,
  CodeTab,
  ModelMode,
} from "../data/code-examples";
import { BrowserHeader, BrowserRoot } from "./browser-window";
import { HighlightedCode } from "./highlighted-code";
import { Select } from "./select";

export interface HighlightedTab extends CodeTab {
  modeTokens?: Record<ModelMode, ThemedToken[][]>;
  tokens: ThemedToken[][];
}

export interface HighlightedGroup extends Omit<CodeExampleGroup, "examples"> {
  examples: HighlightedTab[];
}

export const CodeShowcaseClient = ({
  groups,
}: {
  groups: HighlightedGroup[];
}) => {
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const group = groups.find((item) => item.id === groupId) ?? groups[0];
  const [activeLabel, setActiveLabel] = useState(
    group?.examples[0]?.label ?? ""
  );
  const activeTab =
    group?.examples.find((tab) => tab.label === activeLabel) ??
    group?.examples[0];
  const [mode, setMode] = useState<ModelMode>("gateway");
  const modeSelectId = useId();

  if (!(group && activeTab)) {
    return null;
  }

  const selectGroup = (id: string) => {
    setGroupId(id);
    const firstLabel = groups.find((item) => item.id === id)?.examples[0]
      ?.label;
    if (firstLabel) {
      setActiveLabel(firstLabel);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-10 lg:col-span-4 lg:col-start-1 lg:self-center">
        {groups.map((item, index) => {
          const isActive = item.id === group.id;
          return (
            <Fragment key={item.id}>
              {index > 0 ? (
                <div
                  aria-hidden="true"
                  className="h-px w-full bg-gradient-to-r from-90% from-gray-200 to-transparent"
                />
              ) : null}
              <button
                aria-pressed={isActive}
                className="group flex flex-col gap-3 text-left"
                onClick={() => selectGroup(item.id)}
                type="button"
              >
                <span
                  className={cn(
                    "font-medium! text-heading-16 transition-colors duration-250 sm:text-heading-24",
                    isActive
                      ? "text-gray-1000"
                      : "text-gray-900 group-hover:text-gray-1000"
                  )}
                >
                  {item.label}
                </span>
                <span className="text-copy-16 text-gray-900">
                  {item.description}
                </span>
              </button>
            </Fragment>
          );
        })}
        <Button asChild className="self-start rounded-full">
          <DynamicLink href="/[lang]/docs">Read the docs</DynamicLink>
        </Button>
      </div>

      <div className="@container flex min-w-0 flex-col gap-4 lg:col-span-6 lg:col-start-7">
        <SlidingTabs.Root
          onValueChange={setActiveLabel}
          value={activeTab.label}
        >
          <SlidingTabs.List aria-label={`${group.label} examples`}>
            {group.examples.map((tab) => (
              <SlidingTabs.Tab key={tab.label} value={tab.label}>
                {tab.label}
              </SlidingTabs.Tab>
            ))}
            <SlidingTabs.Indicator />
          </SlidingTabs.List>
        </SlidingTabs.Root>

        {/* The site's dark theme lifts background-100 to gray; scope it back
            to the page black so the window sits flush with the page. */}
        <BrowserRoot className="group dark:[--ds-background-100:var(--ds-background-200)]">
          <BrowserHeader className="mb-px" title={activeTab.filename} />
          <HighlightedCode
            className="h-[309px] [&_pre]:min-h-[309px] [&_pre]:px-2 [&_pre]:py-6"
            key={`${activeTab.label}-${mode}`}
            tokens={activeTab.modeTokens?.[mode] ?? activeTab.tokens}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-background-100 to-transparent"
          />
          {activeTab.modeTokens ? (
            <label
              className="absolute right-4 bottom-4 z-10 flex items-center gap-2 text-copy-13 text-gray-900"
              htmlFor={modeSelectId}
            >
              <span className="max-sm:hidden">Use with</span>
              <Select
                aria-label="Use with"
                id={modeSelectId}
                onChange={(event) => setMode(event.target.value as ModelMode)}
                value={mode}
              >
                <option value="gateway">AI Gateway</option>
                <option value="provider">Provider</option>
                <option value="custom">Custom provider</option>
              </Select>
            </label>
          ) : null}
        </BrowserRoot>

        {groups.length > 1 ? (
          <div
            aria-label="Select example group"
            className="flex items-center justify-center"
            role="tablist"
          >
            {groups.map((item) => {
              const isActive = item.id === group.id;
              return (
                <button
                  aria-label={item.label}
                  aria-selected={isActive}
                  className="flex items-center justify-center p-2"
                  key={item.id}
                  onClick={() => selectGroup(item.id)}
                  role="tab"
                  type="button"
                >
                  <span
                    className={cn(
                      "size-2 rounded-full transition-colors",
                      isActive ? "bg-gray-900" : "bg-gray-500"
                    )}
                  />
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </>
  );
};
