"use client";
import UploadErrorPage from "@/components/common/UploadErrorPage";
export default function ExportError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return <UploadErrorPage error={error} reset={reset} backHref="/export" backLabel="Back to Export" />;
}
