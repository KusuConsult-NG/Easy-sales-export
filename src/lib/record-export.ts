import { recordDataExportAction } from "@/app/actions/data-export-audit";

/**
 * Fire the audit row for a CSV the admin just downloaded — #309.
 *
 * WHY A WRAPPER AND NOT THIRTEEN CALLS
 * ------------------------------------
 * Because the thirteen call sites differ in one awkward way: some export
 * handlers are `async` and some are not, so `await` is not available everywhere.
 * Written out at each site that becomes thirteen slightly different shapes, and
 * the difference that would matter is whether the failure is noticed — which is
 * the bit this codebase keeps getting wrong in exactly this situation.
 *
 * So the promise is handled here, once. The call site is one line and cannot
 * accidentally become a bare `void`.
 *
 * WHY IT DOES NOT BLOCK THE DOWNLOAD
 * ----------------------------------
 * The file is already in the browser by the time this runs — every one of these
 * handlers builds a Blob and clicks an anchor before anything else. There is no
 * version of this that can prevent an export; the honest goal is that the export
 * leaves a trace, and that a failure to leave one is visible rather than silent.
 */
export function recordExport(
    dataset: string,
    details: { count?: number; filters?: Record<string, unknown> } = {},
): void {
    recordDataExportAction(dataset, details)
        .then((result: any) => {
            if (!result?.success) {
                console.error(
                    `[export] the ${dataset} download was NOT recorded in the audit log: `
                    + `${result?.error ?? "no reason given"}`,
                );
            }
        })
        .catch((error: unknown) => {
            console.error(`[export] the ${dataset} download was NOT recorded in the audit log:`, error);
        });
}
