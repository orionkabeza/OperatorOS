/**
 * Reminder/broadcast template merge-field rendering (D.6.5's schedule
 * builder "live template preview using merge fields"). Pure string
 * substitution, deliberately separated from any component so it's directly
 * unit-testable — same discipline as lib/basket-math.ts and lib/debt-math.ts.
 *
 * Merge fields per docs/plans/phase-2.md §4: `{customer}`, `{amount}`,
 * `{days_overdue}`, `{oldest_invoice_date}`, `{pay_link}`.
 */

export const MERGE_FIELDS = ["customer", "amount", "days_overdue", "oldest_invoice_date", "pay_link"] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

export interface RenderResult {
  /** The template with every present field substituted; a field with no value in `fields` is left as the literal `{field}` token, never silently blanked — a missing merge field should be visible, not invisible, when previewing. */
  text: string;
  /** Which of the fields actually referenced in the template had no value supplied. */
  missingFields: string[];
  /** Which of the fields actually referenced in the template were supplied. */
  presentFields: string[];
}

const TOKEN_RE = /\{([a-z_]+)\}/g;

export function renderTemplate(template: string, fields: Partial<Record<MergeField, string>>): RenderResult {
  const missing = new Set<string>();
  const present = new Set<string>();
  const text = template.replace(TOKEN_RE, (match, key: string) => {
    const value = fields[key as MergeField];
    if (value === undefined || value === "") {
      missing.add(key);
      return match;
    }
    present.add(key);
    return value;
  });
  return { text, missingFields: [...missing], presentFields: [...present] };
}

/** Which merge fields a template body references at all, regardless of whether values were supplied — used to validate a template before saving. */
export function fieldsReferencedBy(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(TOKEN_RE)) {
    found.add(match[1]!);
  }
  return [...found];
}
