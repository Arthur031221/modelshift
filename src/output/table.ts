import { visibleLength } from "./colors.js";

export interface Column {
  key: string;
  header: string;
  align?: "left" | "right";
  /** Cells longer than this are shortened. Paths keep their tail, other cells keep their head. */
  maxWidth?: number;
  keepTail?: boolean;
}

export type Row = Record<string, string>;

function shorten(value: string, max: number, keepTail: boolean): string {
  if (visibleLength(value) <= max) return value;
  if (max <= 3) return value.slice(0, max);
  return keepTail ? `...${value.slice(value.length - (max - 3))}` : `${value.slice(0, max - 3)}...`;
}

function pad(value: string, width: number, align: "left" | "right"): string {
  const gap = Math.max(0, width - visibleLength(value));
  return align === "right" ? " ".repeat(gap) + value : value + " ".repeat(gap);
}

export function renderTable(columns: Column[], rows: Row[]): string {
  const cells = rows.map((row) =>
    columns.map((col) => {
      const raw = row[col.key] ?? "";
      return col.maxWidth ? shorten(raw, col.maxWidth, Boolean(col.keepTail)) : raw;
    }),
  );
  const widths = columns.map((col, i) =>
    Math.max(col.header.length, ...cells.map((r) => visibleLength(r[i] ?? ""))),
  );
  const lines: string[] = [];
  lines.push(columns.map((col, i) => pad(col.header, widths[i]!, col.align ?? "left")).join("  "));
  for (const row of cells) {
    lines.push(
      columns.map((col, i) => pad(row[i] ?? "", widths[i]!, col.align ?? "left")).join("  "),
    );
  }
  return lines.join("\n");
}
