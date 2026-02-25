"use client";
import UploadErrorPage from "@/components/common/UploadErrorPage";
export default function CooperativesOnboardingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return <UploadErrorPage error={error} reset={reset} backHref="/cooperatives" backLabel="Back to Cooperatives" />;
}
