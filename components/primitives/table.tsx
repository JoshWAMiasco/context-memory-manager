import type { ComponentProps } from "react";
import { mergeClassNames } from "@/utilities/merge-class-names";

export type TableSize = "small" | "medium";
export type TableAppearance = "plain" | "list";

export interface TableProps extends ComponentProps<"table"> {
  size?: TableSize;
  appearance?: TableAppearance;
  isDark?: boolean;
  isBordered?: boolean;
  isHoverable?: boolean;
  isStriped?: boolean;
}

const tableAppearanceClassNames: Record<TableAppearance, string> = {
  plain: "",
  list: "border-b border-line/60 [&_thead_td]:border-t [&_thead_td]:border-line/60 [&_thead_td]:bg-surface-subtle [&_thead_td]:py-4 [&_thead_td]:font-medium [&_thead_td]:text-foreground-muted [&_thead_th]:border-t [&_thead_th]:border-b [&_thead_th]:border-line/60 [&_thead_th]:bg-surface-subtle [&_thead_th]:py-4 [&_thead_th]:text-foreground-muted [&_tbody_td]:border-dashed [&_tbody_td]:py-4 [&_tbody_tr:last-child_td]:border-b-0",
};

const tableCellPaddingClassNames: Record<TableSize, string> = {
  small: "[&_td]:px-4 [&_td]:py-2 [&_th]:px-4 [&_th]:py-2",
  medium: "[&_td]:px-5 [&_td]:py-3 [&_th]:px-5 [&_th]:py-3",
};

/**
 * A data table in the theme's style. Compose it from `TableHead`, `TableBody`, `TableRow`,
 * `TableHeaderCell` and `TableCell`. Server component with zero client JavaScript.
 * `appearance="list"` gives a list look (shaded header, dashed row separators).
 *
 * @example
 * <Table isStriped isHoverable>
 *   <TableHead>
 *     <TableRow>
 *       <TableHeaderCell>Name</TableHeaderCell>
 *       <TableHeaderCell>Email</TableHeaderCell>
 *     </TableRow>
 *   </TableHead>
 *   <TableBody>
 *     {users.map((user) => (
 *       <TableRow key={user.id}>
 *         <TableCell>{user.fullName}</TableCell>
 *         <TableCell>{user.emailAddress}</TableCell>
 *       </TableRow>
 *     ))}
 *   </TableBody>
 * </Table>
 */
export function Table({ size = "medium", appearance = "plain", isDark = false, isBordered = false, isHoverable = false, isStriped = false, className, ...tableAttributes }: TableProps) {
  return (
    <table
      className={mergeClassNames(
        "w-full text-left",
        tableCellPaddingClassNames[size],
        tableAppearanceClassNames[appearance],
        isDark && "bg-dark text-on-neutral",
        isBordered && "[&_td]:border-l [&_td]:border-r [&_td]:border-t [&_th]:border-l [&_th]:border-r [&_th]:border-t",
        isHoverable && "[&_tbody_tr:hover_td]:bg-surface-muted",
        isStriped && "[&_tbody_tr:nth-of-type(odd)_td]:bg-surface-muted",
        className,
      )}
      {...tableAttributes}
    />
  );
}

/**
 * The table header row group.
 *
 * @example
 * <TableHead><TableRow>…</TableRow></TableHead>
 */
export function TableHead(theadAttributes: ComponentProps<"thead">) {
  return <thead {...theadAttributes} />;
}

/**
 * The table body row group.
 *
 * @example
 * <TableBody>{rows}</TableBody>
 */
export function TableBody(tbodyAttributes: ComponentProps<"tbody">) {
  return <tbody {...tbodyAttributes} />;
}

/**
 * A table row.
 *
 * @example
 * <TableRow className="bg-primary text-on-primary">…</TableRow>
 */
export function TableRow(rowAttributes: ComponentProps<"tr">) {
  return <tr {...rowAttributes} />;
}

/**
 * A header cell with a bold bottom border.
 *
 * @example
 * <TableHeaderCell className="w-44">Joined date</TableHeaderCell>
 */
export function TableHeaderCell({ className, ...cellAttributes }: ComponentProps<"th">) {
  return <th className={mergeClassNames("border-b-2 font-medium whitespace-nowrap", className)} {...cellAttributes} />;
}

/**
 * A body cell with a bottom border.
 *
 * @example
 * <TableCell className="whitespace-nowrap">{user.fullName}</TableCell>
 */
export function TableCell({ className, ...cellAttributes }: ComponentProps<"td">) {
  return <td className={mergeClassNames("border-b", className)} {...cellAttributes} />;
}
