"use server";

import { requireSession } from "@/lib/session-guard";
import { isAdmin } from "@/lib/admin-permissions";
import { logger } from "@/lib/logger";
import { withFlexibleSafeAction, type ActionResponse } from "@/lib/safe-action";
// #528 The rule that validates the dataset and writes the row lives in
// lib/data-export-record, so the three SERVER export routes share it rather
// than restating it three more times. This action keeps its own gate.
import { writeDataExportRecord } from "@/lib/data-export-record";

/**
 * Recording that an admin downloaded a spreadsheet of people.
 *
 *   #309 FOURTEEN ADMIN SCREENS BUILD A CSV. ONE OF THEM RECORDED IT.
 *
 *        Every one of these pages assembles a file and hands it to the browser:
 *
 *          academy/applications          logged
 *          ── and then ──
 *          marketplace/sellers           not logged
 *          marketplace/buyers            not logged
 *          wave/members                  not logged
 *          wave/applications             not logged
 *          wave/compliance               not logged
 *          wave/registrations            not logged
 *          export/applications           not logged
 *          farm-nation/applications      not logged
 *          farm-nation/land-verification not logged
 *          cooperatives/transactions     not logged
 *          cooperatives/loans            not logged
 *          finance                       not logged
 *          audit-logs                    not logged
 *
 *        cooperatives/loans read as the second logged one and is not.
 *        getAdminLoanApplicationsExportAction sounds like the academy's
 *        logAcademyExportAction and does something else entirely: it checks the
 *        admin gate, reads up to 5,000 rows across two collections, joins each
 *        borrower's user record for their bank details, and returns them. It
 *        writes no audit row at any point. A name is not a control.
 *
 *        #146 and #147 established what is in several of those lists: BVN, NIN,
 *        bank account numbers and next of kin. So the platform's most complete
 *        copies of members' identity data could be taken to a laptop with no
 *        record that anybody had.
 *
 *        The last row is the one to read twice. The audit log itself can be
 *        exported, and that export was not audited.
 *
 *        This is #157's shape — "resolving a dispute moved escrow money and
 *        wrote nothing to the admin audit log" — at scale, and it is the
 *        complement of the open #64 decision. #64 asks WHO may export. This
 *        asks whether anyone can tell that they did.
 *
 * WHY THE DATASET IS A CLOSED LIST
 * --------------------------------
 * Because logAcademyExportAction — the one this generalises — had to be fixed
 * once already for taking its details from the caller behind a session check
 * alone, which let any signed-in user write entries into the record of who read
 * applicant data. Its comment says it: "A record anybody can write to is not
 * evidence." The admin gate is kept, and the dataset name is checked against
 * the set below rather than written through, so a caller cannot invent a
 * target to file a misleading row under.
 */
// THE LIST LIVES IN lib/server-action-values — #382.
//
// A "use server" module may only export async functions: every export is
// registered as a server action, and an array is not callable, so the build
// refused the module. Callers import it from lib/server-action-values, and
// this module no longer needs it directly: #528 moved the check into
// lib/data-export-record so the server export routes apply the same one.

async function _recordDataExportAction(
    dataset: string,
    details: { count?: number; filters?: Record<string, unknown> } = {},
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        }
        const { session } = sessionResult;

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const outcome = await writeDataExportRecord({
            dataset,
            userId: session.user.id,
            count: details.count,
            filters: details.filters ?? null,
        });

        if (!outcome.recorded) {
            return {
                success: false as const,
                error: outcome.reason === "unknown_dataset" ? "Unknown dataset" : "Could not record the export",
                data: null,
            };
        }

        return { success: true as const, error: null, data: null };
    } catch (error: any) {
        logger.error("[DataExport] failed to record an export", { dataset, error: error?.message });
        return { success: false as const, error: "Could not record the export", data: null };
    }
}

export const recordDataExportAction = withFlexibleSafeAction(
    "recordDataExportAction",
    _recordDataExportAction,
);
