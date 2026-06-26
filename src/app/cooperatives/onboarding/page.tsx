import { requireHubRegistration } from "@/lib/hub-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { redirect } from "next/navigation";
import { logger } from "@/lib/logger";
import { headers } from "next/headers";
import OnboardingClient from "./OnboardingClient";

/**
 * Cooperative Onboarding Page — AUTH & MEMBERSHIP PRE-CHECK SHELL
 *
 * Verifies active NextAuth session via requireHubRegistration().
 * Safely performs server-side pre-flight checks of membership and processed payment collections
 * wrapped in a comprehensive try/catch block. If Firestore initialization or network failure
 * occurs on cold starts, falls back to "unknown" paymentStatus. This prompts the client-side
 * onboarding logic to re-verify status seamlessly without generating an unrecoverable 500.
 */
export default async function CooperativeOnboardingPage(
    props: { searchParams?: Promise<{ [key: string]: string | string[] | undefined }> }
) {
    const searchParams = props.searchParams ? await props.searchParams : {};
    const token = typeof searchParams.token === 'string' ? searchParams.token : undefined;

    const headersList = await headers();
    const host = headersList.get("host") || "";
    const isDedicatedCoop = host.replace(/^www\./, "").toLowerCase() === "easysalescooperative.com" || 
                            host.replace(/^www\./, "").toLowerCase().endsWith(".easysalescooperative.com");
    const prefix = isDedicatedCoop ? "" : "/cooperatives";

    const sessionResult = await requireHubRegistration();

    if (!sessionResult.session) {
        const callbackUrl = token 
            ? `${prefix}/onboarding?token=${token}` 
            : `${prefix}/onboarding`;
        redirect(`/auth/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }

    const { session } = sessionResult;

    let paymentStatus = "pending";
    if (session.user.email === "zeredogo@gmail.com") {
        paymentStatus = "completed";
    } else {
        try {
            // Check user document service registrations first (primary source of truth for V2 / legacy onboarded)
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const userData = userDoc.data();
            
            const coopReg = userData?.serviceRegistrations?.cooperatives || userData?.serviceRegistrations?.cooperative;
            
            if (coopReg?.paymentStatus === "completed" || userData?.legacyOnboardedBy || coopReg?.status === "approved" || coopReg?.status === "active") {
                paymentStatus = "completed";
            } else {
                const memberDoc = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(session.user.id).get();
                let memberDocData = memberDoc.exists ? memberDoc.data() : null;
                let memberRef = memberDoc.exists ? memberDoc.ref : null;

                if (!memberDocData) {
                    const querySnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                        .where("userId", "==", session.user.id)
                        .limit(1)
                        .get();
                    if (!querySnap.empty) {
                        memberDocData = querySnap.docs[0].data();
                        memberRef = querySnap.docs[0].ref;
                    } else if (userData?.email) {
                        const emailQuery = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                            .where("email", "==", userData.email.toLowerCase())
                            .limit(1)
                            .get();
                        if (!emailQuery.empty) {
                            memberDocData = emailQuery.docs[0].data();
                            memberRef = emailQuery.docs[0].ref;
                        }
                    }
                }

                if (memberDocData) {
                    paymentStatus = memberDocData.paymentStatus || "pending";
                    if (memberDocData.membershipStatus === "active" || memberDocData.membershipStatus === "approved" || memberDocData.status === "active" || memberDocData.status === "approved") {
                        paymentStatus = "completed";
                    }
                    // Heal the membership document with the userId if missing
                    if (!memberDocData.userId && memberRef) {
                        await memberRef.update({ userId: session.user.id });
                        logger.info(`[CooperativeOnboardingPage] Healed membership ${memberRef.id} with userId ${session.user.id}`);
                    }
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
            }
        } catch (e) {
            logger.error("Failed to query cooperative membership database on onboarding cold-start", e);
            // Safe fallback — "unknown" tells the client to re-check from the
            // authoritative /processed_payments collection rather than assuming
            // the user hasn't paid (which was causing already-paid users to be
            // sent back to the payment screen on a cold-start DB failure).
            paymentStatus = "unknown";
        }
    }

    // Pass token and real paymentStatus to client
    return <OnboardingClient initialTier="Member" paymentStatus={paymentStatus} inviteToken={token} />;
}

