"use client";

import {
  FloatingArrow,
  FloatingPortal,
  arrow,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
  type Placement,
} from "@floating-ui/react";
import { useState, type ReactNode } from "react";
import { mergeClassNames } from "@/utilities/merge-class-names";

export type TooltipTheme = "dark" | "light";

const tooltipThemeClassNames: Record<TooltipTheme, { box: string; arrow: string }> = {
  dark: { box: "border border-line-strong bg-dark text-on-neutral", arrow: "fill-dark" },
  light: { box: "border border-line-strong bg-surface-strong text-foreground-strong shadow-overlay", arrow: "fill-surface-strong" },
};

export interface TooltipProps {
  content: ReactNode;
  placement?: Placement;
  theme?: TooltipTheme;
  className?: string;
  children: ReactNode;
}

/**
 * Shows `content` in a small bubble when the wrapped element is hovered or focused.
 *
 * @example
 * <Tooltip content="Copy to clipboard"><Button variant="outline-secondary">Copy</Button></Tooltip>
 * <Tooltip content="Profile completeness" theme="light" placement="bottom"><ProgressBar value={68} /></Tooltip>
 */
export function Tooltip({ content, placement = "top", theme = "dark", className, children }: TooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [referenceElement, setReferenceElement] = useState<HTMLSpanElement | null>(null);
  const [floatingElement, setFloatingElement] = useState<HTMLDivElement | null>(null);
  const [arrowElement, setArrowElement] = useState<SVGSVGElement | null>(null);
  const { floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement,
    elements: { reference: referenceElement, floating: floatingElement },
    whileElementsMounted: autoUpdate,
    middleware: [offset(10), flip(), shift({ padding: 8 }), arrow({ element: arrowElement })],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([useHover(context, { move: false }), useFocus(context), useDismiss(context), useRole(context, { role: "tooltip" })]);

  return (
    <>
      <span ref={setReferenceElement} className={mergeClassNames("inline-flex", className)} {...getReferenceProps()}>
        {children}
      </span>
      {isOpen && (
        <FloatingPortal>
          <div ref={setFloatingElement} style={floatingStyles} className={mergeClassNames("z-[70] rounded-md px-3 py-1.5 text-sm", tooltipThemeClassNames[theme].box)} {...getFloatingProps()}>
            {content}
            <FloatingArrow ref={setArrowElement} context={context} className={tooltipThemeClassNames[theme].arrow} />
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
