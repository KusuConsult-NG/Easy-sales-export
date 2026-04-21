import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

/**
 * Hub Registration Landing Page
 * 
 * Centralized redirect node to handle users failing the `requireHubRegistration` guard.
 * Users must fully register their base profile before boarding any module.
 */
export default async function HubRegisterPage() {
    const session = await auth();

    // If unauthenticated, they need to create an account
    if (!session?.user) {
        redirect("/auth/register");
    }

    // If authenticated, it means they are caught by the Hub Guard because their 
    // profile is missing mandatory fields (like a phone number from legacy signups).
    // Send them to the profile page to complete their data.
    redirect("/profile?notice=complete-your-hub-registration");
}
