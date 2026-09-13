import { logger } from "@/lib/logger";
import { html, trustedHtml } from "@/lib/utils";
import { canSendEmail, sendEmailNotification } from "@/lib/email-notifications";
import { createNotification } from "@/infrastructure/notifications/service";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 *   #688 TELLING THE MEMBER WHAT WAS DECIDED — ONCE, FOR EVERY DOOR.
 *
 *   Seven admin paths write an approval or a rejection into LOAN_APPLICATIONS.
 *   TWO of them told the member:
 *
 *       actions/admin/_loans.ts::_approveLoanApplication        email + bell
 *       actions/admin/_loans.ts::_rejectLoanApplication         email + bell
 *       cooperative/_loans_decisions.ts::approveLoanAction      SILENT
 *       cooperative/_loans_decisions.ts::rejectLoanAction       SILENT
 *       api/admin/cooperative/approve-loan                      SILENT
 *       api/admin/cooperative/reject-loan                       SILENT
 *       actions/loan-actions.ts::approveLoanApplication         SILENT
 *
 *   A cooperative member whose loan was decided on the cooperative screens
 *   learned nothing: no email, no bell, no SMS. The rejection even records a
 *   `rejectionReason` the member was never shown. They find out by opening
 *   /loans and noticing the status changed — if they think to look.
 *
 *   This is the shape the audit's own record calls "the fix reached one of N
 *   doors", and it is the same reason lib/loan-approval-policy.ts exists: the
 *   guarantor gate was applied on two doors of three until #619. A rule that
 *   lives in one caller is a rule the next caller will not have.
 *
 *   SO IT LIVES HERE, and every door calls it — including the two that already
 *   did the work, so there is one copy of the wording and one place to correct
 *   it rather than three that drift.
 *
 *   IT NEVER THROWS. The decision is already committed by the time this runs;
 *   a failed email must not turn a successful approval into an error the admin
 *   retries. Failures are logged, which is #394's lesson — the sends that
 *   swallowed Resend's returned errors were invisible for months.
 */

export type LoanDecision = "approved" | "rejected";

export interface LoanDecisionNotice {
    /** The applicant. */
    userId: string;
    decision: LoanDecision;
    amount: number;
    /** Required in substance for a rejection — it is the thing the member needs. */
    reason?: string;
    /**
     * Read from the user record when the caller does not have it.
     *
     * The cooperative doors hold a LoanApplication, which does not carry an
     * address; _loans.ts holds one that does. Resolving it here rather than at
     * each door is what lets all seven call the same function.
     */
    userEmail?: string;
    /** Approval only: whether the money has already moved. */
    disbursed?: boolean;
    /** Approval only, and optional: the doors that hold the figures pass them. */
    terms?: {
        durationMonths?: number;
        interestRate?: number;
        monthlyPayment?: number;
        totalRepayment?: number;
    };
}

async function resolveEmail(userId: string, given?: string): Promise<string | undefined> {
    if (typeof given === "string" && given.trim()) return given;
    try {
        const snap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const email = snap.exists ? (snap.data() ?? {}).email : undefined;
        return typeof email === "string" && email.trim() ? email : undefined;
    } catch (error) {
        logger.error("[loan-decision] could not resolve an address for the notice", { userId, error });
        return undefined;
    }
}

/**
 *   The figures block, included only when a caller actually has the figures.
 *
 *   BUILT WITH html`` AND MARKED TRUSTED, which #512's ratchet insisted on and
 *   was right to. The first version assembled plain template strings and
 *   interpolated the result into the outer html`` tag — which ESCAPES what it
 *   is given, so the member would have received a literal `&lt;p&gt;` where the
 *   loan details should be. trustedHtml is how an already-escaped fragment says
 *   so; the VALUES inside it are still escaped by the inner tag.
 */
function termsBlock(terms: LoanDecisionNotice["terms"]) {
    const rows: string[] = [];
    if (typeof terms?.durationMonths === "number") {
        rows.push(html`<p><strong>Duration:</strong> ${terms.durationMonths} months</p>`);
    }
    if (typeof terms?.interestRate === "number") {
        rows.push(html`<p><strong>Interest Rate:</strong> ${terms.interestRate}% per month</p>`);
    }
    if (typeof terms?.monthlyPayment === "number") {
        rows.push(html`<p><strong>Monthly Payment:</strong> ₦${Math.round(terms.monthlyPayment).toLocaleString()}</p>`);
    }
    if (typeof terms?.totalRepayment === "number") {
        rows.push(html`<p><strong>Total Repayment:</strong> ₦${Math.round(terms.totalRepayment).toLocaleString()}</p>`);
    }
    return trustedHtml(rows.join(""));
}

export async function notifyLoanDecision(notice: LoanDecisionNotice): Promise<void> {
    const { userId, decision, amount, reason, disbursed } = notice;
    const naira = `₦${Number(amount || 0).toLocaleString()}`;

    //   THE BELL FIRST. It is the channel that always exists — email needs
    //   RESEND_API_KEY and an address on the record, and this platform is
    //   deployed today without the key in some environments. A member who gets
    //   no email must still get the notification.
    try {
        await createNotification(
            decision === "approved"
                ? {
                    userId,
                    type: "loan",
                    title: "Loan Approved",
                    message: disbursed
                        ? `Your loan of ${naira} has been approved and disbursed to your bank account.`
                        : `Your loan application for ${naira} has been approved. Disbursement will follow shortly.`,
                    link: "/loans",
                    linkText: "View Loans",
                }
                : {
                    userId,
                    type: "loan",
                    title: "Loan Application Declined",
                    //   The reason is IN the message, not only in the record.
                    //   A member told "declined" with no reason has nothing to
                    //   act on, and the reason was already being written to the
                    //   application where only an admin could read it.
                    message: reason
                        ? `Your loan application for ${naira} was not approved. Reason: ${reason}`
                        : `Your loan application for ${naira} was not approved.`,
                    link: "/loans",
                    linkText: "View Details",
                } as any,
        );
    } catch (error) {
        logger.error("[loan-decision] in-app notice failed", { userId, decision, error });
    }

    const to = await resolveEmail(userId, notice.userEmail);
    if (!canSendEmail("loan decision email", to)) return;

    try {
        const { error: sendError } = await sendEmailNotification({
            from: process.env.EMAIL_FROM || "Easy Sales Export <info@easysalesexport.com>",
            to,
            subject: decision === "approved" ? "Loan Application Approved!" : "Loan Application Update",
            message: decision === "approved"
                ? html`
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #10b981;">Congratulations! Your Loan is Approved</h2>
                        <p>Great news! Your loan application has been approved by our admin team.</p>
                        <div style="background: #f0fdf4; padding: 16px; border-radius: 8px; margin: 20px 0;">
                            <h3 style="color: #059669; margin-top: 0;">Loan Details:</h3>
                            <p><strong>Amount:</strong> ${naira}</p>
                            ${termsBlock(notice.terms)}
                        </div>
                        <p><strong>Next Steps:</strong></p>
                        <ul>
                            <li>${disbursed
                                ? "Your funds have been transferred to your bank account."
                                : "Funds will be disbursed to your account shortly."}</li>
                            <li>Your first repayment is due 30 days from disbursement</li>
                            <li>You can track your repayment schedule in your dashboard</li>
                        </ul>
                        <p>Thank you for being a valued member of our cooperative!</p>
                    </div>
                `
                : html`
                    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
                        <h2 style="color:#dc2626">Loan Application Update</h2>
                        <div style="background:#fef2f2;padding:16px;border-radius:8px;margin:20px 0">
                            <p>Unfortunately, we are unable to approve your loan application at this time.</p>
                            <p><strong>Amount:</strong> ${naira}</p>
                            ${reason ? trustedHtml(html`<p><strong>Reason:</strong> ${reason}</p>`) : ""}
                        </div>
                    </div>
                `,
            metadata: { type: "loan_decision" },
        });
        //   #394 Resend RETURNS its errors rather than throwing them, so a
        //   refused or rate-limited send is invisible unless the result is read.
        if (sendError) logger.error("[loan-decision] email send failed", { userId, decision, error: sendError });
    } catch (error) {
        logger.error("[loan-decision] email threw", { userId, decision, error });
    }
}
