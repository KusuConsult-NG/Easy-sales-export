import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session-guard";

/**
 * Hub Registration Landing Page
 * 
 * Centralized redirect node to handle users failing the `requireHubRegistration` guard.
 * Users must fully register their base profile before boarding any module.
 */
export default async function HubRegisterPage() {
    const sessionResult = await requireSession();

    // If unauthenticated, banned, or session expired, redirect to login with the error message
    if (!sessionResult.session) {
        const errorMessage = sessionResult.error?.error || "Authentication required";
        redirect(`/auth/login?error=${encodeURIComponent(errorMessage)}`);
    }

    // If authenticated, it means they are caught by the Hub Guard because their 
    // profile is missing mandatory fields (like a phone number from legacy signups).
    // Send them to the profile page to complete their data.
    redirect("/profile?notice=complete-your-hub-registration");
}
