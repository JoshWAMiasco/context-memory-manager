import type { ReactNode } from "react";
import { ScrollAwareElement } from "@/components/layout-shell/scroll-aware-element";

/**
 * Nests `children` inside one `div` per class list, outermost first, as a theme's shell often has
 * several wrapper layers. A layer whose classes include `top-bar` becomes scroll-aware (gets
 * `top-bar--active` after scrolling) when `hasScrollAwareTopBar` is on.
 *
 * @example
 * <ShellWrappers classNameLayers={["fixed inset-x-0 top-0", "box mx-5 h-full"]}>{topBarItems}</ShellWrappers>
 */
export function ShellWrappers({
  classNameLayers,
  hasScrollAwareTopBar = false,
  children,
}: {
  classNameLayers: readonly string[];
  hasScrollAwareTopBar?: boolean;
  children: ReactNode;
}) {
  return classNameLayers.reduceRight<ReactNode>((wrappedContent, layerClassName) => {
    if (hasScrollAwareTopBar && layerClassName.split(/\s+/).includes("top-bar")) {
      return (
        <ScrollAwareElement className={layerClassName} classNameWhenScrolled="top-bar--active">
          {wrappedContent}
        </ScrollAwareElement>
      );
    }
    return <div className={layerClassName}>{wrappedContent}</div>;
  }, children);
}
