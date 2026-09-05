"use client";

import { AlertTriangle } from "lucide-react";

/**
 *   #415 THE LINE THAT SAYS "WE COULD NOT CHECK", ONCE.
 *
 *   All five pending screens (wave, academy, export, marketplace, farm-nation)
 *   leave the waiting page on `applicationStatus === "approved"`. Until #415 a
 *   failed read answered "pending", so an approved applicant was held on that
 *   page being told to wait, and an expired session produced the same page
 *   instead of a prompt to sign in.
 *
 *   The status the screen shows is now the LAST ONE ACTUALLY READ, and this is
 *   how the screen admits that the newest poll did not answer. One component
 *   rather than five wordings, for the reason #390 records.
 */
export function StatusCheckNotice({
    checkFailed,
    sessionExpired,
}: {
    checkFailed: boolean;
    sessionExpired: boolean;
}) {
    if (!checkFailed) return null;

    return (
        <div
            role="status"
            className="mb-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-left"
        >
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="text-sm text-amber-900">
                {sessionExpired ? (
                    <>
                        <p className="font-semibold">Please sign in again</p>
                        <p>
                            Your session has expired, so this page cannot confirm where your
                            application stands. Sign in again to see its current status.
                        </p>
                    </>
                ) : (
                    <>
                        <p className="font-semibold">We could not confirm your status just now</p>
                        <p>
                            What you see below is the last status we were able to read. We are
                            still checking — if your application has moved on, this page will
                            update on its own.
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}
