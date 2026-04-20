"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Children,
  type ComponentPropsWithoutRef,
  createContext,
  isValidElement,
  type JSX,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { IconCheck } from "@/components/geistcn-fallbacks/geistcn-assets/icons/icon-check";
import { IconCopy } from "@/components/geistcn-fallbacks/geistcn-assets/icons/icon-copy";
import { cn } from "@/lib/utils";

type CommandPromptContextValue = {
  value: string;
  setValue: (value: string) => void;
  copied: boolean;
  copyActiveValue: () => void;
  activeCopyValue: string;
  setActiveCopyValue: (value: string) => void;
  commandWidth?: number;
  setCommandWidth: (value: number | undefined) => void;
  isOverflowing: boolean;
  setIsOverflowing: (value: boolean) => void;
  canShowGradient: boolean;
  setCanShowGradient: (value: boolean) => void;
};

const CommandPromptContext = createContext<CommandPromptContextValue | null>(
  null
);

function useCommandPromptContext(component: string) {
  const context = useContext(CommandPromptContext);

  if (!context) {
    throw new Error(`${component} must be used within CommandPrompt.Root`);
  }

  return context;
}

type CommandPromptRootProps = Omit<
  ComponentPropsWithoutRef<"div">,
  "onChange"
> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};

export function CommandPromptRoot({
  value: valueProp,
  defaultValue,
  onValueChange,
  className,
  children,
  ...props
}: CommandPromptRootProps): JSX.Element {
  const [uncontrolledValue, setUncontrolledValue] = useState(
    defaultValue ?? ""
  );
  const [copied, setCopied] = useState(false);
  const [activeCopyValue, setActiveCopyValue] = useState("");
  const [commandWidth, setCommandWidth] = useState<number>();
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [canShowGradient, setCanShowGradient] = useState(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
  const value = valueProp ?? uncontrolledValue;

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function resetCopiedState() {
    setCopied(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }

  function setValue(nextValue: string) {
    if (valueProp === undefined) {
      setUncontrolledValue(nextValue);
    }

    resetCopiedState();
    onValueChange?.(nextValue);
  }

  function copyActiveValue() {
    if (!activeCopyValue) return;

    void navigator.clipboard.writeText(activeCopyValue);
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 1000);
  }

  return (
    <CommandPromptContext.Provider
      value={{
        value,
        setValue,
        copied,
        copyActiveValue,
        activeCopyValue,
        setActiveCopyValue,
        commandWidth,
        setCommandWidth,
        isOverflowing,
        setIsOverflowing,
        canShowGradient,
        setCanShowGradient,
      }}
    >
      <div
        className={cn("w-full flex items-center flex-col gap-2", className)}
        {...props}
      >
        {children}
      </div>
    </CommandPromptContext.Provider>
  );
}

export function CommandPromptList({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">): JSX.Element {
  return <div className={cn("flex items-center", className)} {...props} />;
}

type CommandPromptTriggerProps = ComponentPropsWithoutRef<"button"> & {
  value: string;
};

export function CommandPromptTrigger({
  value,
  className,
  onClick,
  children,
  ...props
}: CommandPromptTriggerProps): JSX.Element {
  const context = useCommandPromptContext("CommandPrompt.Trigger");
  const active = context.value === value;

  return (
    <button
      aria-pressed={active}
      className={cn(
        "cursor-pointer text-gray-900 hover:text-gray-1000 px-3 py-2",
        "text-label-13! font-medium! touch-manipulation border-none bg-transparent rounded-sm",
        "outline outline-2 outline-offset-2 outline-transparent focus-visible:outline-[var(--ds-focus-color)]",
        "text-gray-900 data-[active]:text-gray-1000 data-[active]:font-medium",
        "flex gap-1.5 items-center whitespace-nowrap",
        className
      )}
      data-active={active ? "" : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        context.setValue(value);
      }}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

export function CommandPromptTriggerDivider({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">): JSX.Element {
  return (
    <div
      aria-hidden
      className={cn("w-px h-3 bg-gray-400", className)}
      {...props}
    />
  );
}

export function CommandPromptSurface({
  className,
  onClick,
  children,
}: {
  className?: string;
  children: ReactNode;
  onClick?: ComponentPropsWithoutRef<"div">["onClick"];
}): JSX.Element {
  const context = useCommandPromptContext("CommandPrompt.Surface");
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      className={cn(
        "relative flex items-center group gap-1 material-small transition-colors pl-5 py-2 pr-3 max-w-[calc(100vw-48px)] rounded-full",
        className
      )}
      layout
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (window.getSelection()?.toString()) return;
        context.copyActiveValue();
      }}
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : { type: "spring", bounce: 0, duration: 0.4 }
      }
    >
      {children}
    </motion.div>
  );
}

export function CommandPromptPrefix({
  className,
  ...props
}: ComponentPropsWithoutRef<"span">): JSX.Element {
  return (
    <span
      className={cn("block text-label-16-mono! text-gray-500 pr-1", className)}
      {...props}
    />
  );
}

type CommandPromptContentProps = {
  value: string;
  copyValue?: string;
  className?: string;
  children: ReactNode;
};

export function CommandPromptViewport({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}): JSX.Element {
  const context = useCommandPromptContext("CommandPrompt.Viewport");
  const shouldReduceMotion = useReducedMotion();
  const {
    commandWidth,
    canShowGradient,
    isOverflowing,
    setActiveCopyValue,
    setCanShowGradient,
    setCommandWidth,
    setIsOverflowing,
  } = context;
  const measureRef = useRef<HTMLSpanElement>(null);
  const scrollObserverCleanup = useRef<(() => void) | null>(null);
  const items = Children.toArray(children)
    .filter((child): child is React.ReactElement<CommandPromptContentProps> =>
      isValidElement<CommandPromptContentProps>(child)
    )
    .map((child) => child.props);
  const activeItem = items.find((item) => item.value === context.value);
  const command = activeItem?.children ?? null;
  const fallbackCopyValue =
    typeof command === "string" || typeof command === "number"
      ? String(command)
      : Children.toArray(command)
          .filter(
            (child): child is string | number =>
              typeof child === "string" || typeof child === "number"
          )
          .join("");
  const copyValue = activeItem?.copyValue ?? fallbackCopyValue;

  useLayoutEffect(() => {
    setIsOverflowing(false);
    setCanShowGradient(Boolean(shouldReduceMotion));
  }, [copyValue, setCanShowGradient, setIsOverflowing, shouldReduceMotion]);

  useEffect(() => {
    setActiveCopyValue(copyValue);

    return () => {
      setIsOverflowing(false);
      scrollObserverCleanup.current?.();
      scrollObserverCleanup.current = null;
    };
  }, [copyValue, setActiveCopyValue, setIsOverflowing]);

  useLayoutEffect(() => {
    if (!measureRef.current) return;

    setCommandWidth(measureRef.current.getBoundingClientRect().width);
  }, [command, copyValue, setCommandWidth]);

  return (
    <motion.span
      animate={
        commandWidth === undefined
          ? undefined
          : { width: shouldReduceMotion ? "auto" : commandWidth }
      }
      className={cn(
        "relative block min-w-0 overflow-hidden text-label-14-mono! text-gray-1000",
        className
      )}
      initial={false}
      onAnimationComplete={() => {
        setCanShowGradient(true);
      }}
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : { type: "spring", bounce: 0, duration: 0.4 }
      }
    >
      <span
        aria-hidden
        className="pointer-events-none invisible absolute whitespace-nowrap"
        ref={measureRef}
      >
        {command}
      </span>
      <AnimatePresence initial={false} mode="wait">
        {Children.toArray(children).map((child) => {
          if (!isValidElement<CommandPromptContentProps>(child)) return null;
          if (child.props.value !== context.value) return null;

          return (
            <motion.span
              animate={{ opacity: 1, filter: "blur(0px)" }}
              className={cn(
                "block whitespace-nowrap min-w-0 py-2",
                canShowGradient && isOverflowing
                  ? "overflow-x-auto"
                  : "overflow-x-hidden",
                child.props.className
              )}
              exit={{ opacity: 0, filter: "blur(1px)" }}
              initial={{ opacity: 0, filter: "blur(1px)" }}
              key={copyValue}
              ref={(element) => {
                scrollObserverCleanup.current?.();
                scrollObserverCleanup.current = null;
                if (!element) return;

                const checkOverflow = () => {
                  setIsOverflowing(element.scrollWidth > element.clientWidth);
                };

                checkOverflow();
                const observer = new ResizeObserver(checkOverflow);
                observer.observe(element);
                scrollObserverCleanup.current = () => observer.disconnect();
              }}
              transition={
                shouldReduceMotion ? { duration: 0 } : { duration: 0.15 }
              }
            >
              {child.props.children}
            </motion.span>
          );
        })}
      </AnimatePresence>
      <AnimatePresence>
        {canShowGradient && isOverflowing && (
          <motion.span
            animate={{ opacity: 1 }}
            aria-hidden
            className="pointer-events-none block z-10 absolute right-0 bg-gradient-to-r from-transparent to-background-100 top-0 bottom-0 w-4"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            transition={
              shouldReduceMotion ? { duration: 0 } : { duration: 0.2 }
            }
          />
        )}
      </AnimatePresence>
    </motion.span>
  );
}

export function CommandPromptContent(
  _props: CommandPromptContentProps
): JSX.Element | null {
  return null;
}

export function CommandPromptCopy({
  className,
  onClick,
  ...props
}: ComponentPropsWithoutRef<"button">): JSX.Element {
  const context = useCommandPromptContext("CommandPrompt.Copy");
  const shouldReduceMotion = useReducedMotion();

  return (
    <button
      aria-label={context.copied ? "Copied" : "Copy command"}
      className={cn(
        "text-gray-1000 rounded-full border-none bg-transparent shrink-0 cursor-pointer relative size-8 flex items-center justify-center translate-x-0.5",
        "group-hover:bg-gray-alpha-100 hover:!bg-gray-alpha-200 transition-colors touch-manipulation",
        "outline-2 outline-offset-2 outline-transparent focus-visible:outline-[var(--ds-focus-color)]",
        className
      )}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        event.stopPropagation();
        context.copyActiveValue();
      }}
      type="button"
      {...props}
    >
      <AnimatePresence initial={false}>
        {!context.copied && (
          <motion.span
            animate={{
              opacity: 1,
              transform: "scale(1)",
              filter: "blur(0px)",
            }}
            className="absolute inset-0 flex items-center justify-center"
            exit={{
              opacity: 0,
              transform: "scale(0.5)",
              filter: "blur(1px)",
            }}
            initial={{
              opacity: 0,
              transform: "scale(0.5)",
              filter: "blur(1px)",
            }}
            key="copy"
            transition={
              shouldReduceMotion
                ? { duration: 0 }
                : { duration: 0.2, ease: [0.23, 1, 0.32, 1] }
            }
          >
            <IconCopy className="block" size={16} />
          </motion.span>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {context.copied && (
          <motion.span
            animate={{
              opacity: 1,
              transform: "scale(1)",
              filter: "blur(0px)",
            }}
            className="absolute inset-0 flex items-center justify-center"
            exit={{
              opacity: 0,
              transform: "scale(0.5)",
              filter: "blur(1px)",
            }}
            initial={{
              opacity: 0,
              transform: "scale(0.5)",
              filter: "blur(1px)",
            }}
            key="check"
            transition={
              shouldReduceMotion
                ? { duration: 0 }
                : { duration: 0.2, ease: [0.23, 1, 0.32, 1] }
            }
          >
            <IconCheck className="block" size={16} />
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}
