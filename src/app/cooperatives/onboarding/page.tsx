
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getAdminDb } from "@/lib/firebase-admin";
import OnboardingClient from "./OnboardingClient";
import { COLLECTIONS } from "@/lib/types/firestore";

export default async function CooperativeOnboardingPage() {
    const session = await auth();

    if (!session?.user) {
        redirect("/cooperatives/login");
    }

    const userId = session.user.id;
    const db = getAdminDb();

    // Check membership status
    const memberDoc = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).get();

    if (!memberDoc.exists) {
        // No record at all = hasn't started payment flow
        redirect("/cooperatives/payment");
    }

    const memberData = memberDoc.data();

    // 1. Payment Check
    if (memberData?.paymentStatus !== "completed") {
        redirect("/cooperatives/payment");
    }

    // 2. Status Check
    const status = memberData?.membershipStatus;

    if (status === "active" || status === "approved") {
        redirect("/cooperatives/dashboard");
    }

    if (status === "pending" || status === "under_review") {
        redirect("/cooperatives/onboarding/pending");
    }

    // 3. Render Client Form
    // If we get here, payment is done but registration is not fully submitted/approved
    // Pass the tier from the server record
    return (
        <OnboardingClient
            initialTier={memberData?.membershipTier || "basic"}
        />
    );
}
