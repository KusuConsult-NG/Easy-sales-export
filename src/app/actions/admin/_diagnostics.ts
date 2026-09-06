"use server";

import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { requireSession } from "@/lib/session-guard";
import { runSystemHealthDiagnostic } from "@/app/actions/health";

/**
 *   #440 A SECOND HEALTH SCREEN ANSWERED IN CONSTANTS, BESIDE THE ONE THAT DOES
 *   THE WORK.
 *
 * This action was, in full:
 *
 *     const stats = { totalUsers: 0, corruptedUsers: 0, legacyVerified: 0,
 *         missingNames: 0, desyncedRegistrations: 0, orphanedApplications: 0 };
 *     const services = { redis: true, paystack: true, resend: true,
 *         firestore: true };
 *
 * Four constants and six zeros, rendered by
 * /admin/system-health/diagnostics as four green "Healthy" cards and six clean
 * counts under the heading "Real-time data integrity audit and service status
 * monitoring". An operator opening the screen because they suspected the
 * platform was broken was told everything was fine — with Redis down, with
 * Paystack unconfigured, with the database unreachable. Its own comment
 * admitted it: "in production these would be real counts".
 *
 * This is the class #331, #372 and #373 repaired in the forensic checks and
 * #313 in the MFA status: a check that cannot fail is worse than no check,
 * because somebody trusts it.
 *
 * AND THE REAL ONE WAS ONE DIRECTORY UP. /admin/system-health renders
 * `runSystemHealthDiagnostic`, which scans up to 2,000 user profiles, probes
 * Redis, counts orphaned WAVE applications and reads the feature toggles. The
 * two carry THE SAME FIELD NAMES — services.redis / firestore / paystack /
 * resend, stats.corruptedUsers / orphanedApplications / desyncedRegistrations —
 * so this was a copy of that report's shape with the work removed.
 *
 * WHICH IS WHY THIS FILE NOW DELEGATES RATHER THAN COMPUTING. My first pass at
 * the repair wrote fresh probes here, and that would have been a THIRD
 * statement of "is the platform healthy" — the exact mistake this audit has
 * found nine times over (#425, #426, #429–#434, #438, #439). One implementation,
 * two names; the name stays because the admin barrel exports it and the screen
 * calls it.
 */
async function _runSystemDiagnosticAction(): Promise<ActionResponse<any>> {
    /**
     * A door of its own, in front of the delegation.
     *
     * THREE EXISTING RATCHETS FAILED ON MY FIRST VERSION OF THIS FILE, which
     * delegated with no guard of its own — action-auth-per-function,
     * action-security-audit and admin-barrel-parity all read per file, and all
     * three said the same true thing: this file reaches no authorisation guard.
     *
     * The delegate does check, so the action was not open. But a wrapper whose
     * only protection lives behind a call it does not control is exactly the
     * shape those ratchets exist to refuse, and satisfying them by adding an
     * exemption would spend a real control to keep a convenience. So this
     * refuses an anonymous caller here, and the PERMISSION decision still
     * belongs to the one implementation rather than being restated.
     */
    const sessionResult = await requireSession();
    if (!sessionResult.session) {
        return { success: false as const, error: "Authentication required", data: null };
    }

    return await runSystemHealthDiagnostic() as ActionResponse<any>;
}


export const runSystemDiagnosticAction = withFlexibleSafeAction("runSystemDiagnosticAction", _runSystemDiagnosticAction);
