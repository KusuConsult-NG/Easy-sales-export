/**
 * Render sample credentials to PDF, for showing a client before anything ships.
 *
 *   Run:  npx tsx scripts/render-credential-samples.tsx [outDir]
 *
 *   THE OWNER: "i need the sample of the certificate so i can verify it with
 *   the client."
 *
 *   WHY A SCRIPT RATHER THAN A SCREENSHOT. #809 is the reason. The logo used
 *   to be fetched over HTTP from the server's own hostname, and when that
 *   failed @react-pdf did not throw — it logged "Not valid image extension"
 *   and rendered the page anyway, so a certificate went out with a blank space
 *   where the company's mark belongs and nothing said so. That defect is
 *   invisible in a screenshot of the happy path and obvious in the file size:
 *
 *       local path   57,018 bytes        remote URL   1,215 bytes  <- no logo
 *
 *   So this renders the REAL document through the REAL renderer and prints the
 *   byte count, which is the cheapest check that the logo actually landed.
 *
 *   No database, no network, no credentials: it takes the sample values below
 *   and nothing else, so it is safe to run anywhere and cannot touch live data.
 */

import { renderToBuffer } from "@react-pdf/renderer";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

import { CertificateDocument } from "@/components/pdf/CertificateDocument";
import { brandLogoDataUri } from "@/lib/brand-logo";
import { CREDENTIAL_BRAND } from "@/lib/credential-brand";

/** Plausible rather than placeholder — a client is judging the typography. */
const SAMPLE = {
    studentName: "Aminat Folake Ajibola",
    courseTitle: "Agricultural Export Documentation and Compliance",
    completionDate: "12 September 2026",
    certificateId: "ESE-ACAD-2026-004182",
    instructor: "Dr. Chinedu Okafor",
    baseUrl: "https://www.easysalesexport.com",
};

async function main() {
    const outDir = process.argv[2] ?? join(process.cwd(), "credential-samples");
    mkdirSync(outDir, { recursive: true });

    //   Stated before rendering, because a missing logo is the one failure that
    //   does not announce itself.
    const logo = brandLogoDataUri();
    console.log(logo
        ? `logo: loaded from disk (${logo.length} chars of data URI)`
        : "logo: MISSING — the certificate will render without it, silently");

    console.log(`palette: ${Object.entries(CREDENTIAL_BRAND).map(([k, v]) => `${k} ${v}`).join(", ")}`);

    const buffer = await renderToBuffer(CertificateDocument(SAMPLE) as never);
    const file = join(outDir, "certificate-sample.pdf");
    writeFileSync(file, buffer);

    console.log(`\ncertificate: ${file}  (${buffer.length.toLocaleString()} bytes)`);
    if (buffer.length < 10_000) {
        console.log("  WARNING: under 10kB. #809's signature — the logo probably did not embed.");
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
