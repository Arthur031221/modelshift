import type { Status } from "../registry/types.js";
import type { Finding } from "../scan/index.js";
import { dim, green, red, yellow } from "./colors.js";

export function statusLabel(f: Pick<Finding, "status" | "daysLeft" | "date">): string {
  switch (f.status) {
    case "retired":
      return f.date ? `retired ${f.date}` : "retired";
    case "retiring":
      if (f.daysLeft === 0) return `retires today (${f.date})`;
      return `retiring in ${f.daysLeft} days (${f.date})`;
    case "deprecated":
      return f.date && f.daysLeft !== null ? `deprecated, retires ${f.date}` : "deprecated";
    case "eligible":
      if (f.daysLeft !== null && f.daysLeft <= 0) return `eligible for retirement since ${f.date}`;
      return `eligible for retirement from ${f.date}`;
    case "active":
      return "active";
    default:
      return "unknown";
  }
}

export function colorStatus(status: Status, label: string): string {
  switch (status) {
    case "retired":
    case "retiring":
      return red(label);
    case "deprecated":
    case "eligible":
      return yellow(label);
    case "active":
      return green(label);
    default:
      return dim(label);
  }
}

export function shortUrl(url: string | null): string {
  if (!url) return "";
  return url.replace(/^https?:\/\//, "").replace(/#.*$/, "");
}

export function plural(n: number, word: string): string {
  if (n === 1) return `${n} ${word}`;
  const consonantY = /[^aeiou]y$/i.test(word);
  const plural = consonantY ? `${word.slice(0, -1)}ies` : `${word}s`;
  return `${n} ${plural}`;
}
