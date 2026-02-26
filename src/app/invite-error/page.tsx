/**
 * Invite Error Page
 * Shown when a WhatsApp invite link is invalid, already used, or expired.
 */

import Link from "next/link";

const MESSAGES: Record<string, { title: string; body: string }> = {
    used: {
        title: "Link Already Used",
        body: "This WhatsApp invite link has already been redeemed. Each link can only be used once. If you believe this is a mistake, please contact our support team.",
    },
    expired: {
        title: "Link Expired",
        body: "This WhatsApp invite link has expired (links are valid for 7 days). Please contact our support team to request a new invite.",
    },
    invalid: {
        title: "Invalid Invite Link",
        body: "This invite link is not valid. Please use the link sent to your registered email address.",
    },
    unavailable: {
        title: "Group Temporarily Unavailable",
        body: "The WhatsApp group is temporarily unavailable. Please try again later or contact support.",
    },
    error: {
        title: "Something Went Wrong",
        body: "We encountered an error processing your invite. Please try again or contact support.",
    },
};

export default function InviteErrorPage({
    searchParams,
}: {
    searchParams: { reason?: string };
}) {
    const reason = searchParams?.reason || "invalid";
    const msg = MESSAGES[reason] || MESSAGES["invalid"];

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
            <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    </svg>
                </div>

                <h1 className="text-2xl font-bold text-slate-900 mb-3">{msg.title}</h1>
                <p className="text-slate-600 mb-8 leading-relaxed">{msg.body}</p>

                <div className="space-y-3">
                    <Link
                        href="/"
                        className="block w-full py-3 px-6 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition-colors text-center"
                    >
                        Go to Homepage
                    </Link>
                    <Link
                        href="/contact"
                        className="block w-full py-3 px-6 bg-slate-100 text-slate-700 font-semibold rounded-xl hover:bg-slate-200 transition-colors text-center"
                    >
                        Contact Support
                    </Link>
                </div>
            </div>
        </div>
    );
}
