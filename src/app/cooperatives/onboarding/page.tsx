
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getAdminDb } from "@/lib/firebase-admin";
import OnboardingClient from "./OnboardingClient";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";

export default async function CooperativeOnboardingPage() {
    const session = await auth();

    if (!session?.user) {
        redirect("/auth/login?module=cooperatives");
    }

    const userId = session.user.id;

    // Defensive fetch — Firebase Admin init failure must never produce a raw 500
    let memberData: Record<string, any> | null = null;
    try {
        const db = getAdminDb();
        const memberDoc = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).get();
        memberData = memberDoc.exists ? (memberDoc.data() ?? null) : null;
    } catch (err) {
        logger.error("CooperativeOnboardingPage: Firestore read failed, rendering form with defaults", err);
        // Fall through — user can still see the form; submit action will handle the real state
    }

    // If already approved/active, send to dashboard
    const status = memberData?.membershipStatus;
    if (status === "active" || status === "approved") {
        redirect("/cooperatives/dashboard");
    }

    // Only redirect to pending page if the form has actually been submitted.
    // membershipStatus is set to "pending" as soon as payment is initiated,
    // so we can't use it alone — we check for onboardingCompleted or firstName
    // (set by registerCooperativeMemberAction when the form is submitted).
    const formSubmitted = memberData?.onboardingCompleted === true || !!memberData?.firstName;
    if (formSubmitted && (status === "pending" || status === "under_review")) {
        redirect("/cooperatives/onboarding/pending");
    }

    // Otherwise render the form — pass paymentStatus so the form knows
    // whether to show the Pay button (step 4) or the Submit button (step 4, paid)
    const paymentStatus = memberData?.paymentStatus || "pending";
    const initialTier = memberData?.membershipTier || "basic";

    return (
        <OnboardingClient
            initialTier={initialTier}
            paymentStatus={paymentStatus}
        />
    );
}
