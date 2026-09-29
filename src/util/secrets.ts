/**
 * Best-effort redaction of credentials before a sampled prompt is written to disk
 * or sent to a model. This is a regex pass, not a guarantee. Review the sampled
 * file before running a replay.
 */

interface Rule {
  name: string;
  re: RegExp;
  /** When set, only the value group is replaced and the key name is preserved. */
  keepPrefixGroup?: number;
}

const RULES: Rule[] = [
  {
    name: "private-key",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { name: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "openai-key", re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g },
  { name: "aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "github-token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: "google-key", re: /\bAIza[0-9A-Za-z_-]{30,}/g },
  { name: "stripe-key", re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { name: "huggingface-token", re: /\bhf_[A-Za-z0-9]{30,}\b/g },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: "bearer", re: /\b(bearer\s+)[A-Za-z0-9_\-.=]{16,}/gi, keepPrefixGroup: 1 },
  {
    name: "connection-string",
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql):\/\/[^\s'"`]+/gi,
  },
  {
    name: "assignment",
    re: /\b((?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|secret|token|password|passwd|pwd)\s*[:=]\s*['"]?)([A-Za-z0-9_\-./+=]{12,})/gi,
    keepPrefixGroup: 1,
  },
];

export interface RedactResult {
  text: string;
  redactions: number;
  rules: string[];
}

export function redactSecrets(input: string): RedactResult {
  let text = input;
  let redactions = 0;
  const hit = new Set<string>();
  for (const rule of RULES) {
    text = text.replace(rule.re, (...args: unknown[]) => {
      redactions += 1;
      hit.add(rule.name);
      if (rule.keepPrefixGroup !== undefined) {
        const prefix = String(args[rule.keepPrefixGroup] ?? "");
        return `${prefix}[REDACTED]`;
      }
      return "[REDACTED]";
    });
  }
  return { text, redactions, rules: [...hit] };
}
