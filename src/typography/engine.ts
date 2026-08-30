import type { RawMatch, RuleConfidence, TypographyRule } from "./rule.js";

export * from "./rule.js";

const CONTEXT = 40;
const DEFAULT_SAMPLE = 10;

export interface RuleMatch extends RawMatch {
  ruleId: string;
  title: string;
  /** The text as it currently stands. */
  before: string;
  /** The text it will become. */
  after: string;
  contextBefore: string;
  contextAfter: string;
  confidence: RuleConfidence;
}

export function runRules(text: string, rules: TypographyRule[]): RuleMatch[] {
  const out: RuleMatch[] = [];
  for (const rule of rules) {
    for (const m of rule.match(text)) {
      const downgraded = rule.review?.(m, text) ?? false;
      out.push({
        ...m,
        ruleId: rule.id,
        title: rule.title,
        before: text.slice(m.start, m.end),
        after: m.replacement,
        contextBefore: text.slice(Math.max(0, m.start - CONTEXT), m.start),
        contextAfter: text.slice(m.end, m.end + CONTEXT),
        confidence: downgraded ? "needs-review" : rule.confidence,
      });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * Applies matches. Two rules can claim overlapping ranges — the one
 * that starts earlier wins, and the rest are silently not applied. Silent
 * is acceptable here: the match doesn't disappear from the report, it just
 * doesn't make it into the rewrite, and the next run will pick it up.
 */
export function rewrite(text: string, matches: RuleMatch[]): string {
  const accepted: RuleMatch[] = [];
  let lastEnd = -1;
  for (const m of [...matches].sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (m.start < lastEnd) continue;
    accepted.push(m);
    lastEnd = m.end;
  }

  let out = "";
  let cursor = 0;
  for (const m of accepted) {
    out += text.slice(cursor, m.start) + m.replacement;
    cursor = m.end;
  }
  return out + text.slice(cursor);
}

export interface RuleGroup {
  ruleId: string;
  title: string;
  /** How many matches were found IN TOTAL, including uncertain ones. */
  total: number;
  /** A limited sample of confident matches, for showing to a human. */
  samples: RuleMatch[];
  /** Uncertain matches — confirmed one at a time, not together with the group. */
  needsReview: RuleMatch[];
}

/**
 * The confirmation model is per rule, not per match: on 196 pages,
 * confirming hundreds of matches one by one is hours of work. So the report
 * groups them, shows a sample, and lists uncertain ones separately.
 */
export function groupByRule(matches: RuleMatch[], sampleSize = DEFAULT_SAMPLE): RuleGroup[] {
  const byRule = new Map<string, RuleMatch[]>();
  for (const m of matches) {
    const list = byRule.get(m.ruleId) ?? [];
    list.push(m);
    byRule.set(m.ruleId, list);
  }

  const groups: RuleGroup[] = [];
  for (const [ruleId, list] of byRule) {
    const review = list.filter((m) => m.confidence === "needs-review");
    const confident = list.filter((m) => m.confidence === "high");
    groups.push({
      ruleId,
      title: list[0]!.title,
      total: list.length,
      samples: confident.slice(0, sampleSize),
      needsReview: review,
    });
  }
  return groups.sort((a, b) => b.total - a.total);
}
