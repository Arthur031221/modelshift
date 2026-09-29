let enabled: boolean =
  Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && process.env.TERM !== "dumb";

export function setColorEnabled(value: boolean): void {
  enabled = value;
}

export function colorEnabled(): boolean {
  return enabled;
}

function wrap(code: number, text: string): string {
  return enabled ? `\u001b[${code}m${text}\u001b[0m` : text;
}

export const red = (t: string): string => wrap(31, t);
export const green = (t: string): string => wrap(32, t);
export const yellow = (t: string): string => wrap(33, t);
export const cyan = (t: string): string => wrap(36, t);
export const dim = (t: string): string => wrap(2, t);
export const bold = (t: string): string => wrap(1, t);

/** Visible length of a string, ignoring ANSI escape sequences. */
export function visibleLength(text: string): number {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control characters by design
  return text.replace(/\u001b\[[0-9;]*m/g, "").length;
}
