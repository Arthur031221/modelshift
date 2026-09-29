export interface LifecycleEntry {
  /** Canonical model identifier as the provider spells it. */
  id: string;
  /** openai, anthropic, google, bedrock, or another provider key. */
  provider: string;
  /** Other identifiers that resolve to this entry, such as dateless aliases. */
  aliases: string[];
  /** Date the provider announced the deprecation, ISO date or null. */
  announced: string | null;
  /** Date the model became deprecated (still callable), ISO date or null. */
  deprecated: string | null;
  /** Shutdown date after which requests fail, ISO date or null. */
  retirement: string | null;
  /** Earliest possible retirement stated by the provider when no shutdown is scheduled. */
  retirement_earliest?: string | null;
  /** Recommended replacement identifier, or null when the provider does not name one. */
  replacement: string | null;
  notes: string;
  /** URL of the provider page the dates were taken from. */
  source: string;
}

export interface Registry {
  version: string;
  generated: string;
  sources: Record<string, string>;
  models: LifecycleEntry[];
}

export type Status = "retired" | "retiring" | "deprecated" | "eligible" | "active" | "unknown";

export interface StatusInfo {
  status: Status;
  /** Days until the relevant date. Negative when the date has passed. Null when there is no date. */
  daysLeft: number | null;
  /** The date the status was derived from, if any. */
  date: string | null;
}

export const STATUS_ORDER: Record<Status, number> = {
  retired: 0,
  retiring: 1,
  deprecated: 2,
  eligible: 3,
  active: 4,
  unknown: 5,
};
