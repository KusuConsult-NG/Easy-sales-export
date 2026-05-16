/**
 * /api/id-card/pdf
 *
 * Server-side PDF generator for the Cooperative Membership ID Card.
 *
 * WHY: html2canvas cannot resolve Tailwind v4 CSS custom properties
 * (var(--color-*), color-mix()) on mobile browsers. Any attempt to
 * capture the card element via html2canvas on Android/iOS causes a
 * blank/corrupt canvas or an outright throw, showing the user
 * "Download failed". Generating the PDF on the server avoids all
 * CSS, CORS, and canvas constraints entirely.
 *
 * OUTPUT: CR80 card (86mm × 54mm), landscape, returned as
 *         application/pdf so the browser prompts a save dialog.
 */

import { NextRequest, NextResponse } from "next/server";
import { jsPDF } from "jspdf";
import { requireSession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtShort(iso: string): string {
    if (!iso) return "—";
    try {
        return new Intl.DateTimeFormat("en-NG", { year: "numeric", month: "short" }).format(new Date(iso));
    } catch {
        return iso;
    }
}

/** Fetch a remote image and return it as a base64 data URI (jpeg). */
async function fetchImageAsBase64(url: string): Promise<string | null> {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return null;
        const buffer = await res.arrayBuffer();
        const mime = res.headers.get("content-type") || "image/jpeg";
        return `data:${mime};base64,${Buffer.from(buffer).toString("base64")}`;
    } catch {
        return null;
    }
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    try {
        // Auth guard — must be a logged-in user
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return NextResponse.json({ error: "Authentication required" }, { status: 401 });
        }

        const data = await req.json();
        const {
            fullName,
            memberNumber,
            gender,
            stateOfOrigin,
            joinedAt,
            validUntil,
            passportPhotoUrl,
        } = data;

        // ── Generate PDF ──────────────────────────────────────────────────────

        // CR80 card: 86mm × 54mm — landscape
        const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: [86, 54] });

        // ── Background gradient simulation (3 rectangles) ──────────────────
        // Purple gradient: #6b21a8 → #7e22ce → #3730a3
        pdf.setFillColor(107, 33, 168);
        pdf.rect(0, 0, 29, 54, "F");
        pdf.setFillColor(126, 34, 206);
        pdf.rect(29, 0, 28, 54, "F");
        pdf.setFillColor(55, 48, 163);
        pdf.rect(57, 0, 29, 54, "F");

        // ── Holographic shimmer strip ──────────────────────────────────────
        pdf.setFillColor(255, 255, 255);
        pdf.setGState(new (pdf as any).GState({ opacity: 0.3 }));
        pdf.rect(0, 0, 86, 1.5, "F");
        pdf.setGState(new (pdf as any).GState({ opacity: 1 }));

        // ── Header ────────────────────────────────────────────────────────
        pdf.setDrawColor(255, 255, 255);
        pdf.setLineWidth(0.2);
        pdf.line(5, 11, 81, 11); // border-b white/20

        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(6.5);
        pdf.setFont("helvetica", "bold");
        pdf.text("EASY SALES EXPORT LTD", 5, 7);
        pdf.setFontSize(4.5);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(200, 180, 255);
        pdf.text("COOPERATIVE MEMBERSHIP", 5, 10);

        // MEMBER badge (top-right)
        pdf.setFillColor(196, 181, 253); // purple-300
        pdf.roundedRect(68, 3, 13, 4.5, 1, 1, "F");
        pdf.setTextColor(88, 28, 135); // purple-900
        pdf.setFontSize(4);
        pdf.setFont("helvetica", "bold");
        pdf.text("MEMBER", 74.5, 6.2, { align: "center" });

        // ── Passport photo ────────────────────────────────────────────────
        const photoX = 5;
        const photoY = 13;
        const photoW = 17;
        const photoH = 22;

        let photoBase64: string | null = null;
        if (passportPhotoUrl) {
            photoBase64 = await fetchImageAsBase64(passportPhotoUrl);
        }

        // Photo border
        pdf.setDrawColor(255, 255, 255);
        pdf.setLineWidth(0.4);
        pdf.roundedRect(photoX, photoY, photoW, photoH, 1, 1, "S");

        if (photoBase64) {
            pdf.addImage(photoBase64, "JPEG", photoX, photoY, photoW, photoH);
        } else {
            // Placeholder
            pdf.setFillColor(255, 255, 255, 0.1);
            pdf.roundedRect(photoX, photoY, photoW, photoH, 1, 1, "F");
            pdf.setTextColor(200, 200, 255);
            pdf.setFontSize(4);
            pdf.text("No Photo", photoX + photoW / 2, photoY + photoH / 2, { align: "center" });
        }

        // ── Member details ─────────────────────────────────────────────────
        const detailX = 25;
        const detailY = 15;

        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(7);
        pdf.setFont("helvetica", "bold");
        pdf.text(fullName || "—", detailX, detailY);

        pdf.setFontSize(4);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(200, 180, 255);
        pdf.text(memberNumber || "—", detailX, detailY + 4);

        const rows = [
            ["Gender", gender || "—"],
            ["State", stateOfOrigin || "—"],
            ["Issued", fmtShort(joinedAt)],
            ["Valid Until", fmtShort(validUntil)],
        ];

        let rowY = detailY + 8;
        rows.forEach(([label, value]) => {
            pdf.setTextColor(180, 160, 240);
            pdf.setFontSize(4);
            pdf.text(label, detailX, rowY);

            pdf.setTextColor(255, 255, 255);
            pdf.setFont("helvetica", "bold");
            pdf.text(value, 81, rowY, { align: "right" });
            pdf.setFont("helvetica", "normal");
            rowY += 4.5;
        });

        // ── Footer ────────────────────────────────────────────────────────
        pdf.setDrawColor(255, 255, 255);
        pdf.setLineWidth(0.15);
        pdf.line(5, 46, 81, 46);

        // Dots
        for (let i = 0; i < 20; i++) {
            pdf.setFillColor(255, 255, 255);
            pdf.setGState(new (pdf as any).GState({ opacity: 0.2 }));
            pdf.circle(5 + i * 3, 49, 0.5, "F");
        }
        pdf.setGState(new (pdf as any).GState({ opacity: 1 }));

        pdf.setTextColor(180, 160, 220);
        pdf.setFontSize(3.5);
        pdf.setFont("helvetica", "normal");
        pdf.text("easysalesexport.com", 81, 49, { align: "right" });

        // ── Return PDF ────────────────────────────────────────────────────
        const pdfBuffer = Buffer.from(pdf.output("arraybuffer"));

        return new NextResponse(pdfBuffer, {
            status: 200,
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="ESE-CoopID-${memberNumber || "card"}.pdf"`,
                "Cache-Control": "no-store",
            },
        });
    } catch (error) {
        logger.error("[/api/id-card/pdf] PDF generation error:", error);
        return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
    }
}
