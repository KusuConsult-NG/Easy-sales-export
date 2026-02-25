"use client";
import UploadErrorPage from "@/components/common/UploadErrorPage";
export default function WaveApplicationError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return <UploadErrorPage error={error} reset={reset} backHref="/wave" backLabel="Back to WAVE" />;
}
