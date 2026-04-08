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
export default async function CooperativeOnboardingPage(
    props: { searchParams?: Promise<{ [key: string]: string | string[] | undefined }> }
) {
    const searchParams = props.searchParams ? await props.searchParams : {};
    const token = typeof searchParams.token === 'string' ? searchParams.token : undefined;

    const session = await auth();

    if (!session?.user) {
        const callbackUrl = token 
            ? `/cooperatives/onboarding?token=${token}` 
            : "/cooperatives/onboarding";
        redirect(`/auth/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }

    // Pass token to client
    return <OnboardingClient initialTier="basic" paymentStatus="pending" inviteToken={token} />;
}
