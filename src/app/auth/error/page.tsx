"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowRight } from "lucide-react";
import { Suspense } from "react";

function AuthErrorContent() {
    const searchParams = useSearchParams();
    const error = searchParams.get("error");

    let message = "An unknown error occurred during authentication.";

    if (error === "Configuration") {
        message = "There is a problem with the server configuration. Please try again later.";
    } else if (error === "AccessDenied") {
        message = "You do not have permission to sign in.";
    } else if (error === "Verification") {
        message = "The sign-in link is no longer valid. It may have been used already or it may have expired.";
    } else if (error === "OAuthSignin") {
        message = "Error in constructing an authorization URL.";
    } else if (error === "OAuthCallback") {
        message = "Error in handling the response from an OAuth provider.";
    } else if (error === "OAuthCreateAccount") {
        message = "Could not create OAuth provider user in the database.";
    } else if (error === "EmailCreateAccount") {
        message = "Could not create email provider user in the database.";
    } else if (error === "Callback") {
        message = "Error in the OAuth callback handler route.";
    } else if (error === "OAuthAccountNotLinked") {
        message = "To confirm your identity, sign in with the same account you used originally.";
    } else if (error === "SessionRequired") {
        message = "Please sign in to access this page.";
    } else if (error === "Default") {
        message = "Unable to sign in.";
    } else if (error === "session_expired") {
        message = "Your session has expired. Please sign in again.";
    }

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-100 text-center">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <AlertCircle className="w-8 h-8 text-red-600" />
                </div>

                <h1 className="text-2xl font-bold text-slate-900 mb-2">Authentication Error</h1>
                <p className="text-slate-600 mb-8">{message}</p>

                <p className="text-xs text-slate-400 mb-6 font-mono bg-slate-100 p-2 rounded">Code: {error || "Unknown"}</p>

                <div className="space-y-3">
                    <Link
                        href="/auth/login"
                        className="block w-full py-3 px-4 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"
                    >
                        Try Again
                        <ArrowRight className="w-4 h-4" />
                    </Link>

                    <Link
                        href="/"
                        className="block w-full py-3 px-4 bg-white text-slate-600 font-bold rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
                    >
                        Go Home
                    </Link>
                </div>
            </div>
        </div>
    );
}

export default function AuthErrorPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-slate-50 flex items-center justify-center"><p className="text-slate-500">Loading...</p></div>}>
            <AuthErrorContent />
        </Suspense>
    );
}
