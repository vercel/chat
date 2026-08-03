"use client";

import { cn } from "@/lib/utils";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type JSX,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";

export type SlidingTabsOrientation = "horizontal" | "vertical";

interface SlidingTabsContextValue {
  baseId: string;
  onValueChange: (value: string) => void;
  orientation: SlidingTabsOrientation;
  value: string;
}

interface SlidingTabsListContextValue {
  listRef: MutableRefObject<HTMLDivElement | null>;
}

const SlidingTabsContext = createContext<SlidingTabsContextValue | null>(null);
const SlidingTabsListContext =
  createContext<SlidingTabsListContextValue | null>(null);

export interface SlidingTabsLabelProps extends HTMLAttributes<HTMLSpanElement> {
  active?: boolean;
  activeBackground?: boolean;
  children: ReactNode;
}

function SlidingTabsLabel({
  active,
  activeBackground,
  children,
  className,
  ...props
}: SlidingTabsLabelProps): JSX.Element {
  return (
    <span
      className={cn(
        "relative inline-flex items-center justify-center rounded-[6px] px-3.5 py-1.5 text-center text-copy-14 transition-colors hover:text-gray-1000",
        active ? "text-gray-1000" : "text-gray-900",
        active && activeBackground ? "bg-gray-200" : null,
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="invisible flex items-center justify-center gap-1 font-medium"
      >
        {children}
      </span>
      <span
        className={cn(
          "pointer-events-none absolute inset-0 flex items-center justify-center gap-1",
          {
            "font-medium": active,
          },
        )}
      >
        {children}
      </span>
    </span>
  );
}

function useSlidingTabsContext(componentName: string): SlidingTabsContextValue {
  const context = useContext(SlidingTabsContext);
  if (!context) {
    throw new Error(`${componentName} must be used within SlidingTabs.Root.`);
  }
  return context;
}

function useSlidingTabsListContext(
  componentName: string,
): SlidingTabsListContextValue {
  const context = useContext(SlidingTabsListContext);
  if (!context) {
    throw new Error(`${componentName} must be used within SlidingTabs.List.`);
  }
  return context;
}

export interface SlidingTabsRootProps<
  TValue extends string = string,
> extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  onValueChange: (value: TValue) => void;
  orientation?: SlidingTabsOrientation;
  value: TValue;
}

function SlidingTabsRoot<TValue extends string = string>({
  children,
  onValueChange,
  orientation = "horizontal",
  value,
  ...props
}: SlidingTabsRootProps<TValue>): JSX.Element {
  const baseId = useId();

  return (
    <SlidingTabsContext.Provider
      value={{
        baseId,
        onValueChange: (nextValue) => onValueChange(nextValue as TValue),
        orientation,
        value,
      }}
    >
      <div data-orientation={orientation} {...props}>
        {children}
      </div>
    </SlidingTabsContext.Provider>
  );
}

export interface SlidingTabsListProps extends HTMLAttributes<HTMLDivElement> {
  activateOnFocus?: boolean;
  loopFocus?: boolean;
}

function getEnabledTabs(list: HTMLDivElement | null): HTMLButtonElement[] {
  if (!list) return [];
  return Array.from(
    list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'),
  );
}

function getNextIndex({
  currentIndex,
  direction,
  loopFocus,
  tabCount,
}: {
  currentIndex: number;
  direction: -1 | 1;
  loopFocus: boolean;
  tabCount: number;
}): number {
  const nextIndex = currentIndex + direction;

  if (loopFocus) {
    return (nextIndex + tabCount) % tabCount;
  }

  return Math.min(Math.max(nextIndex, 0), tabCount - 1);
}

function SlidingTabsList({
  activateOnFocus = true,
  children,
  className,
  loopFocus = true,
  onKeyDown,
  ...props
}: SlidingTabsListProps): JSX.Element {
  const { onValueChange, orientation } =
    useSlidingTabsContext("SlidingTabs.List");
  const listRef = useRef<HTMLDivElement | null>(null);

  function selectTab(tab: HTMLButtonElement): void {
    const value = tab.dataset.value;
    if (!value) return;

    tab.focus();
    if (activateOnFocus) {
      onValueChange(value);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    const tabs = getEnabledTabs(listRef.current);
    if (tabs.length === 0) return;

    const currentIndex = Math.max(
      0,
      tabs.indexOf(document.activeElement as HTMLButtonElement),
    );

    if (event.key === "Home") {
      event.preventDefault();
      selectTab(tabs[0]);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      selectTab(tabs[tabs.length - 1]);
      return;
    }

    const previousKeys =
      orientation === "horizontal"
        ? ["ArrowLeft", "ArrowUp"]
        : ["ArrowUp", "ArrowLeft"];
    const nextKeys =
      orientation === "horizontal"
        ? ["ArrowRight", "ArrowDown"]
        : ["ArrowDown", "ArrowRight"];

    if (previousKeys.includes(event.key)) {
      event.preventDefault();
      selectTab(
        tabs[
          getNextIndex({
            currentIndex,
            direction: -1,
            loopFocus,
            tabCount: tabs.length,
          })
        ],
      );
      return;
    }

    if (nextKeys.includes(event.key)) {
      event.preventDefault();
      selectTab(
        tabs[
          getNextIndex({
            currentIndex,
            direction: 1,
            loopFocus,
            tabCount: tabs.length,
          })
        ],
      );
    }
  }

  return (
    <SlidingTabsListContext.Provider value={{ listRef }}>
      <div
        aria-orientation={orientation}
        className={cn(
          "relative inline-flex gap-1 p-1",
          orientation === "horizontal"
            ? "w-full max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] @lg:w-fit @lg:max-w-none [&::-webkit-scrollbar]:hidden"
            : "w-full flex-col",
          className,
        )}
        data-orientation={orientation}
        onKeyDown={handleKeyDown}
        ref={listRef}
        role="tablist"
        {...props}
      >
        {children}
      </div>
    </SlidingTabsListContext.Provider>
  );
}

export interface SlidingTabsTabProps<
  TValue extends string = string,
> extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value"> {
  panelId?: string;
  value: TValue;
}

function SlidingTabsTab<TValue extends string = string>({
  children,
  className,
  disabled,
  id,
  onClick,
  panelId,
  type = "button",
  value,
  ...props
}: SlidingTabsTabProps<TValue>): JSX.Element {
  const {
    baseId,
    onValueChange,
    orientation,
    value: activeValue,
  } = useSlidingTabsContext("SlidingTabs.Tab");
  const tabId = id ?? `${baseId}-${value}`;
  const isActive = activeValue === value;

  return (
    <button
      aria-controls={panelId}
      aria-selected={isActive}
      className={cn(
        "relative z-10 rounded-[6px] focus-visible:outline-none focus-visible:shadow-[var(--ds-focus-ring)]",
        orientation === "horizontal"
          ? "min-w-max flex-none whitespace-nowrap"
          : "w-full",
        className,
      )}
      data-active={isActive ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
      data-orientation={orientation}
      data-value={value}
      disabled={disabled}
      id={tabId}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && !disabled) {
          onValueChange(value);
        }
      }}
      role="tab"
      tabIndex={isActive ? 0 : -1}
      type={type}
      {...props}
    >
      <SlidingTabsLabel
        active={isActive}
        className={cn(orientation === "vertical" ? "w-full" : null)}
      >
        {children}
      </SlidingTabsLabel>
    </button>
  );
}

export type SlidingTabsIndicatorProps = HTMLAttributes<HTMLSpanElement>;

function SlidingTabsIndicator({
  className,
  style,
  ...props
}: SlidingTabsIndicatorProps): JSX.Element | null {
  const { orientation, value } = useSlidingTabsContext("SlidingTabs.Indicator");
  const { listRef } = useSlidingTabsListContext("SlidingTabs.Indicator");
  const [indicator, setIndicator] = useState<{
    height: number;
    left: number;
    top: number;
    width: number;
  } | null>(null);

  const measure = useCallback(() => {
    const activeTab = listRef.current?.querySelector<HTMLElement>(
      '[role="tab"][data-active]',
    );
    if (!activeTab) return;

    setIndicator({
      height: activeTab.offsetHeight,
      left: activeTab.offsetLeft,
      top: activeTab.offsetTop,
      width: activeTab.offsetWidth,
    });
  }, [listRef]);

  useEffect(() => {
    measure();

    const tabList = listRef.current;
    const activeTab = tabList?.querySelector<HTMLElement>(
      '[role="tab"][data-active]',
    );
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;

    if (tabList) observer?.observe(tabList);
    if (activeTab) observer?.observe(activeTab);
    window.addEventListener("resize", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [listRef, measure, value]);

  if (!indicator) return null;

  const cssVariables = {
    "--active-tab-height": `${indicator.height}px`,
    "--active-tab-left": `${indicator.left}px`,
    "--active-tab-top": `${indicator.top}px`,
    "--active-tab-width": `${indicator.width}px`,
  } as CSSProperties;

  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-0 rounded-[6px] bg-gray-200 transition-[left,width,top,height] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none",
        orientation === "horizontal" ? "top-1 bottom-1" : "left-1 right-1",
        className,
      )}
      data-orientation={orientation}
      style={{
        ...cssVariables,
        ...(orientation === "horizontal"
          ? { left: indicator.left, width: indicator.width }
          : { height: indicator.height, top: indicator.top }),
        ...style,
      }}
      {...props}
    />
  );
}

export interface SlidingTabsPanelProps<
  TValue extends string = string,
> extends HTMLAttributes<HTMLDivElement> {
  keepMounted?: boolean;
  value: TValue;
}

function SlidingTabsPanel<TValue extends string = string>({
  children,
  keepMounted = false,
  value,
  ...props
}: SlidingTabsPanelProps<TValue>): JSX.Element | null {
  const {
    baseId,
    orientation,
    value: activeValue,
  } = useSlidingTabsContext("SlidingTabs.Panel");
  const isActive = activeValue === value;

  if (!keepMounted && !isActive) return null;

  return (
    <div
      aria-labelledby={`${baseId}-${value}`}
      data-hidden={isActive ? undefined : ""}
      data-orientation={orientation}
      hidden={!isActive}
      role="tabpanel"
      {...props}
    >
      {children}
    </div>
  );
}

export const SlidingTabs = {
  Indicator: SlidingTabsIndicator,
  List: SlidingTabsList,
  Panel: SlidingTabsPanel,
  Root: SlidingTabsRoot,
  Tab: SlidingTabsTab,
  Label: SlidingTabsLabel,
};
