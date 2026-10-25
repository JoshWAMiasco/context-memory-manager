"use client";

import { useEffect, useState, type ReactNode } from "react";
import { joinClassNames } from "@/utilities/join-class-names";

/**
 * A `div` that swaps class names depending on whether the page has scrolled away from the top,
 * like the `top-bar--active`, `background--hidden` and `mode--light` switches.
 * Children render on the server and react through `group-[.…]` classes.
 *
 * @example
 * <ScrollAwareElement className="top-bar group absolute inset-x-0" classNameWhenScrolled="top-bar--active">
 *   {topBarItems}
 * </ScrollAwareElement>
 */
export function ScrollAwareElement({
  className,
  classNameWhenScrolled,
  classNameAtTop,
  children,
}: {
  className?: string;
  classNameWhenScrolled?: string;
  classNameAtTop?: string;
  children: ReactNode;
}) {
  const [hasScrolled, setHasScrolled] = useState(false);
  useEffect(() => {
    const updateScrollState = () => setHasScrolled(window.scrollY > 0);
    updateScrollState();
    window.addEventListener("scroll", updateScrollState, { passive: true });
    return () => window.removeEventListener("scroll", updateScrollState);
  }, []);
  return (
    <div className={joinClassNames(className, hasScrolled ? classNameWhenScrolled : classNameAtTop)}>{children}</div>
  );
}
