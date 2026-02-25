"use client";
import UploadErrorPage from "@/components/common/UploadErrorPage";
export default function FarmNationError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return <UploadErrorPage error={error} reset={reset} backHref="/farm-nation" backLabel="Back to Farm Nation" />;
}
