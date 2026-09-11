import type { ReactNode } from "react";

/** Horizontal-scroll wrapper every table must use. */
export function TableWrap({ children, className = "", maxHeight }: { children: ReactNode; className?: string; maxHeight?: string }) {
  return (
    <div className={`scroll-x rounded-lg border border-line bg-surface ${className}`} style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
      {children}
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}

export function DataTable<T>({ columns, rows, rowKey, rowClass, empty = "No rows", footer, maxHeight }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T, i: number) => string; rowClass?: (row: T, i: number) => string | undefined; empty?: ReactNode; footer?: ReactNode; maxHeight?: string }) {
  return (
    <TableWrap maxHeight={maxHeight}>
      <table className="tbl">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`${c.align === "right" ? "r" : c.align === "center" ? "c" : ""} ${c.className ?? ""}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="py-6 text-center text-muted">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={rowKey(r, i)} className={rowClass?.(r, i)}>
                {columns.map((c) => (
                  <td key={c.key} className={`${c.align === "right" ? "r" : c.align === "center" ? "c" : ""} ${c.className ?? ""}`}>
                    {c.cell(r, i)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {footer ? <tfoot>{footer}</tfoot> : null}
      </table>
    </TableWrap>
  );
}
