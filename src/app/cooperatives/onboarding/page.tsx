import { auth } from "@/lib/auth";
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
export default async function CooperativeOnboardingPage() {
    const session = await auth();

    if (!session?.user) {
        redirect("/auth/login?callbackUrl=/cooperatives/onboarding");
    }

    // Pass nothing — client checks its own status on mount
    return <OnboardingClient initialTier="basic" paymentStatus="pending" />;
}

