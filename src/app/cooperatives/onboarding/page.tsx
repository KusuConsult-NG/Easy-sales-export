import { requireHubRegistration } from "@/lib/hub-guard";
import { isPaymentBypassAccount } from "@/lib/payment-bypass";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { redirect } from "next/navigation";
import { logger } from "@/lib/logger";
import { headers } from "next/headers";
import { findCooperativeMemberRowForPerson } from "@/lib/cooperative-member-lookup";
import { mayClaimMembershipByEmail } from "@/lib/cooperative-membership-claim";
import { ownedProfileIds, filterByOwner } from "@/lib/owned-profile-ids";
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
    if (isPaymentBypassAccount(session.user.email)) {
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
                /*
                 *   THE SIXTH DOOR WITH THE EMAIL FALLBACK, AND IT WAS NOT ON
                 *   THE LIST OF FIVE.
                 *
                 *   lib/cooperative-membership-claim.ts opens by naming the
                 *   readers that looked a membership up by userId, fell back to
                 *   the document id, and then fell back to the caller's EMAIL.
                 *   It lists five, all of them in src/app/actions/cooperative,
                 *   because that hardening pass was scoped to that directory.
                 *   This page is a sixth, and it does the thing that module
                 *   exists to stop, in full:
                 *
                 *       email match  →  read the row  →  WRITE `userId` onto
                 *       it (the heal below)  →  return it as the caller's
                 *
                 *   "A MATCHING EMAIL IS NOT PROOF OF OWNERSHIP. The caller's
                 *   address comes from their own profile, and profile.ts lets
                 *   them change it." An orphaned membership — someone who paid
                 *   and never finished registering — is held at an address no
                 *   account currently holds, so it is exactly the target that
                 *   is reachable. The heal then binds it permanently:
                 *   savingsBalance, loanBalance, documents, BVN and NIN.
                 *
                 *   Its own words on why one hardened door is not enough:
                 *   "once ANY of them bound the row, the dashboard's own check
                 *   passed trivially because `userId` now matched. A control
                 *   present in one door of five is not a control." It was one
                 *   of six.
                 *
                 *   So: the walk is the shared one, across every profile this
                 *   person owns and live row first, and the email path is kept
                 *   but put behind mayClaimMembershipByEmail — the same gate
                 *   the five siblings go through, which demands a completed
                 *   registration payment tying the row to the caller's MONEY
                 *   rather than to a string they can edit. Kept rather than
                 *   deleted because a genuinely orphaned member does reach this
                 *   page, and that is what the gate is for.
                 */
                const ownRow = await findCooperativeMemberRowForPerson(
                    db.collection(COLLECTIONS.COOPERATIVE_MEMBERS), session.user.id,
                );
                let memberDocData = ownRow?.data ?? null;
                let memberRef = ownRow
                    ? db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(ownRow.id)
                    : null;

                if (!memberDocData && userData?.email) {
                    const emailQuery = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                        .where("email", "==", userData.email.toLowerCase())
                        .limit(1)
                        .get();
                    if (!emailQuery.empty) {
                        const candidate = emailQuery.docs[0];
                        const mayClaim = await mayClaimMembershipByEmail(
                            db,
                            { data: candidate.data(), id: candidate.id },
                            session.user.id,
                        );
                        if (mayClaim) {
                            memberDocData = candidate.data();
                            memberRef = candidate.ref;
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
                    //   EVERY PROFILE THIS PERSON OWNS. A registration fee
                    //   paid before their profile was superseded still paid
                    //   for their membership — the same widening _coop_identity
                    //   got for its own copy of this override.
                    const authPayment = await filterByOwner(
                        db.collection(COLLECTIONS.PROCESSED_PAYMENTS), "userId",
                        await ownedProfileIds(session.user.id),
                    )
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

