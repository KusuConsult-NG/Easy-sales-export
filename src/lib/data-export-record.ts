/**
 * Writing the row that says a spreadsheet of people left the platform.
 *
 *   #528 #309 RECORDED THE FOURTEEN SCREENS THAT BUILD A CSV IN THE BROWSER,
 *        AND COULD NOT SEE THE THREE THAT BUILD ONE ON THE SERVER.
 *
 *   #309's sweep is derived rather than hand-listed, which is why it was
 *   trustworthy and why it found twelve unrecorded exports. Its walk is:
 *
 *       walk(join(process.cwd(), 'src/app/admin'));   // .tsx files
 *       if (src.includes('text/csv')) out.push(...)
 *
 *   A route handler is a `.ts` file under `src/app/api`. No server route could
 *   ever appear in that list, however many CSVs it writes. A SWEEP IS ONLY AS
 *   WIDE AS ITS WALK, and this one's walk stopped at the directory where the
 *   downloads are *clicked* rather than the one where they are *made*.
 *
 *   The three it could not see are the largest exports on the platform:
 *
 *       /api/admin/export/users               every user — .all() over USERS
 *       /api/admin/export/cooperative-members every cooperative member
 *       /api/admin/wave/reports/export        every WAVE applicant
 *
 *   The first is the platform's most complete copy of its membership: id, name,
 *   email, phone, gender, roles, whether a BVN/NIN/TIN/CAC is on file, KYC
 *   status, state, LGA and join date, for every profile. Two of the three are
 *   reached by `window.location.href = "/api/admin/export/users"` — a plain GET
 *   an admin can also perform by typing the URL — and neither calling page
 *   contains a single `recordExport` call.
 *
 * ── AND ON THE THIRD, #309 RECORDED THE WRONG SIDE OF THE SAME EXPORT ───────
 *
 *   wave/compliance/page.tsx IS in #309's list, and it does not build a CSV.
 *   It matched `text/csv` on this line:
 *
 *       const extension = contentType.includes("text/csv") ? "csv" : ...
 *
 *   — sniffing the type of a file the SERVER made. So the walk matched the page
 *   that consumes the export and missed the route that authors it, and the
 *   recordExport added there is best-effort, browser-side, and carries no count.
 *   A direct POST to the route recorded nothing at all.
 *
 * ── WHY THE RECORD BELONGS ON THE SERVER ────────────────────────────────────
 *
 *   #309 stated its own honest limit: "It cannot prevent an export. Every one of
 *   those handlers builds a Blob and clicks an anchor before anything else runs
 *   … an export performed by calling the action directly still leaves no trace."
 *
 *   For a route that limit does not apply. The server is the party producing the
 *   file, so the row can be written where it cannot be skipped by navigating to
 *   the URL, and it can carry what the browser never knew: the true row count,
 *   whether the sweep was truncated, and the address the file went to.
 *
 * ── ONE CONTRACT, TWO CALLERS ───────────────────────────────────────────────
 *
 *   recordDataExportAction already had the rule — validate the dataset against a
 *   closed list, normalise the count, write a `data_export` row. Restating it in
 *   three route handlers would be this audit's other repeated finding, "two
 *   hand-maintained copies of one contract". So the rule lives here and the
 *   server action delegates to it; the action keeps its own session and admin
 *   gate, because a route has already applied a stronger one of its own.
 */

import { createAdminAuditLog, getSecurityContextFromHeaders } from "@/lib/audit-log";
import { logger } from "@/lib/logger";
import { EXPORTABLE_DATASETS } from "@/lib/server-action-values";

export interface DataExportRecord {
    /** Must be one of EXPORTABLE_DATASETS. */
    dataset: string;
    /** The admin the row names. */
    userId: string;
    userEmail?: string;
    /** Rows in the file. Anything non-numeric is stored as null, not NaN. */
    count?: number | null;
    /** What narrowed the export, so a row says what was taken and not just that something was. */
    filters?: Record<string, unknown> | null;
    /**
     * Whether the underlying sweep hit the unbounded ceiling.
     *
     * Only a server-side record can know this, and it is the difference between
     * "here is the membership" and "here is part of it" — see the .all() notes
     * on each of the three routes.
     */
    truncated?: boolean;
    /** Request headers, when there are any: gives the row an IP and a user agent. */
    headers?: Headers;
}

export type DataExportOutcome =
    | { recorded: true }
    | { recorded: false; reason: "unknown_dataset" | "write_failed" };

/**
 * Record one export. Never throws.
 *
 * createAdminAuditLog is already the non-throwing form (see recordAdminAction),
 * for the reason that applies doubly here: the file has been assembled and the
 * admin is waiting for it, and failing the download because the log write failed
 * would destroy the thing the record exists to describe.
 */
export async function writeDataExportRecord(entry: DataExportRecord): Promise<DataExportOutcome> {
    const { dataset, userId, userEmail, filters, truncated, headers } = entry;

    if (!(EXPORTABLE_DATASETS as readonly string[]).includes(dataset)) {
        // Refused rather than filed under whatever the caller named. A row
        // against an unknown target reads as evidence and is not — the same
        // reasoning logAcademyExportAction had to be fixed for once already.
        logger.error(`[DataExport] refused an audit row for an unknown dataset: ${dataset}`, { userId });
        return { recorded: false, reason: "unknown_dataset" };
    }

    const count = Number.isFinite(Number(entry.count)) ? Number(entry.count) : null;

    try {
        await createAdminAuditLog({
            action: "data_export",
            userId,
            userEmail,
            targetId: dataset,
            targetType: "export",
            details: `Exported ${count ?? "an unrecorded number of"} ${dataset} row(s).`
                + (filters ? ` Filters: ${JSON.stringify(filters)}` : "")
                + (truncated ? " THE SWEEP WAS TRUNCATED — the file is incomplete." : ""),
            metadata: {
                dataset,
                count,
                filters: filters ?? null,
                ...(truncated === undefined ? {} : { truncated }),
            },
            ...getSecurityContextFromHeaders(headers),
        });

        return { recorded: true };
    } catch (error: any) {
        // createAdminAuditLog swallows its own failures, so reaching here means
        // something above it threw — still not a reason to fail the export.
        logger.error("[DataExport] failed to record an export", { dataset, error: error?.message });
        return { recorded: false, reason: "write_failed" };
    }
}

/**
 * The same record, for a route handler that must not be delayed by it.
 *
 * Nothing currently uses this — the three routes await, because a CSV that took
 * a full-table sweep to build is not made slower in any way a person notices by
 * one more insert, and awaiting means the row is on disk before the bytes leave.
 * It exists so that a future streaming export has the honest option rather than
 * a bare floating promise, which is how a failure becomes invisible.
 */
export function recordDataExportInBackground(entry: DataExportRecord): void {
    void writeDataExportRecord(entry).then((outcome) => {
        if (!outcome.recorded) {
            logger.error(
                `[DataExport] the ${entry.dataset} export was NOT recorded: ${outcome.reason}`,
            );
        }
    });
}
