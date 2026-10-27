"use client";

import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
} from "@floating-ui/react";
import { useRef, useState, type ComponentType } from "react";
import { mergeClassNames } from "@/utilities/merge-class-names";

export interface ContextMenuAction {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  onSelect: () => void;
  /** Shown as a tooltip; the action is disabled while set. */
  disabledReason?: string;
  tone?: "danger";
  dividerBefore?: boolean;
}

export interface ContextMenuPosition {
  x: number;
  y: number;
}

/**
 * A right-click menu positioned at the pointer with Floating UI (the explorer tree, the
 * dashboard's memory cards). Actions the user can't take are disabled with the reason in a
 * tooltip; arrow keys move between items, Enter selects and Escape or a click elsewhere closes.
 * Render it only while open; `onClose` is called when it should go.
 *
 * @example
 * {menu && <ContextMenu position={menu} actions={actions} onClose={() => setMenu(undefined)} />}
 */
export function ContextMenu({
  position,
  actions,
  onClose,
  testId = "context-menu",
}: {
  position: ContextMenuPosition;
  actions: readonly ContextMenuAction[];
  onClose: () => void;
  testId?: string;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listRef = useRef<(HTMLElement | null)[]>([]);
  const [floatingElement, setFloatingElement] = useState<HTMLDivElement | null>(null);
  const [anchorElement, setAnchorElement] = useState<HTMLSpanElement | null>(null);
  const { floatingStyles, context } = useFloating({
    elements: { reference: anchorElement, floating: floatingElement },
    open: true,
    onOpenChange: (nextIsOpen) => {
      if (!nextIsOpen) onClose();
    },
    placement: "bottom-start",
    strategy: "fixed",
    middleware: [
      offset({ mainAxis: 2, alignmentAxis: 2 }),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      // At most as tall as the room left on screen; the rest scrolls (scrollbar-visible).
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(120, Math.floor(availableHeight))}px`;
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });
  const { getFloatingProps, getItemProps } = useInteractions([
    useDismiss(context),
    useRole(context, { role: "menu" }),
    useListNavigation(context, { listRef, activeIndex, onNavigate: setActiveIndex, loop: true }),
  ]);

  return (
    <FloatingPortal>
      <span
        ref={setAnchorElement}
        aria-hidden="true"
        style={{ position: "fixed", left: position.x, top: position.y, width: 0, height: 0 }}
      />
      <FloatingFocusManager context={context} modal={false}>
        <div
          ref={setFloatingElement}
          style={floatingStyles}
          data-testid={testId}
          tabIndex={-1}
          className="scrollbar-visible z-[70] min-w-56 overflow-y-auto overscroll-contain rounded-md border border-line-strong bg-surface-strong p-1 text-sm shadow-overlay"
          {...getFloatingProps()}
        >
          {actions.map((action, actionIndex) => {
            const ActionIcon = action.icon;
            const isDisabled = action.disabledReason !== undefined;
            return (
              <div key={action.key}>
                {action.dividerBefore && <div className="my-1 border-t border-line/60" />}
                <button
                  type="button"
                  role="menuitem"
                  ref={(element) => {
                    listRef.current[actionIndex] = element;
                  }}
                  aria-disabled={isDisabled}
                  title={action.disabledReason}
                  tabIndex={activeIndex === actionIndex ? 0 : -1}
                  data-testid={`menu-${action.key}`}
                  {...getItemProps({
                    onClick: () => {
                      if (isDisabled) return;
                      onClose();
                      action.onSelect();
                    },
                  })}
                  className={mergeClassNames(
                    "flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left outline-none",
                    action.tone === "danger" ? "text-danger" : "text-foreground",
                    isDisabled ? "cursor-not-allowed opacity-45" : "hover:bg-surface-muted focus:bg-surface-muted",
                  )}
                >
                  <ActionIcon className="h-4 w-4 flex-none stroke-[1.5]" />
                  <span className="flex-1">{action.label}</span>
                  {action.disabledReason && <span className="sr-only">({action.disabledReason})</span>}
                </button>
              </div>
            );
          })}
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
