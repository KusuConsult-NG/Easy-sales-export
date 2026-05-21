import { requireHubRegistration } from "@/lib/hub-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { redirect } from "next/navigation";
import OnboardingClient from "./OnboardingClient";

/**
 * Cooperative Onboarding Page — THIN AUTH SHELL
 *
 * Does NOT read Firestore server-side (Firebase Admin SDK init can throw
 * before any try/catch, producing an unrecoverable 500 in production).
 *
 * Auth guard only — the OnboardingClient checks membership status on
 * mount via checkCooperativeStatusAction(), same pattern used by
 * export, farm-nation, marketplace, and wave onboarding pages.
 */
export default async function CooperativeOnboardingPage(
    props: { searchParams?: Promise<{ [key: string]: string | string[] | undefined }> }
) {
    const searchParams = props.searchParams ? await props.searchParams : {};
    const token = typeof searchParams.token === 'string' ? searchParams.token : undefined;

    const sessionResult = await requireHubRegistration();

    if (!sessionResult.session) {
        const callbackUrl = token 
            ? `/cooperatives/onboarding?token=${token}` 
            : "/cooperatives/onboarding";
        redirect(`/auth/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }

    const { session } = sessionResult;

    let paymentStatus = "pending";
    try {
        const memberDoc = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(session.user.id).get();
        if (memberDoc.exists) {
            paymentStatus = memberDoc.data()?.paymentStatus || "pending";
        }

        // ── AUTHORITATIVE OVERRIDE ──────────────────────────────────────
        // If profile says pending, double check actual payment records
        if (paymentStatus !== "completed") {
            const authPayment = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
                .where("userId", "==", session.user.id)
                .where("type", "==", "cooperative_membership_registration")
                .where("status", "==", "completed")
                .limit(1)
                .get();
                
            if (!authPayment.empty) {
                paymentStatus = "completed";
            }
        }
    } catch (e) {
        // Safe fallback — "unknown" tells the client to re-check from the
        // authoritative /processed_payments collection rather than assuming
        // the user hasn't paid (which was causing already-paid users to be
        // sent back to the payment screen on a cold-start DB failure).
        paymentStatus = "unknown";
    }

    // Pass token and real paymentStatus to client
    return <OnboardingClient initialTier="Member" paymentStatus={paymentStatus} inviteToken={token} />;
}
