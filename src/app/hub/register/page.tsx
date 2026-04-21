import { redirect } from "next/navigation";

/**
 * Hub Registration Landing Page
 * 
 * Centralized redirect node to handle users failing the `requireHubRegistration` guard.
 * Users must fully register their base profile before boarding any module.
 */
export default function HubRegisterPage() {
    // For now, redirect users to the global auth register.
    // If the platform builds a dedicated Hub profile completion page later,
    // this page should be replaced with its implementation.
    redirect("/auth/register");
}
