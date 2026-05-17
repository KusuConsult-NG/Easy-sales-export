/**
 * /api/id-card/pdf
 *
 * Server-side PDF generator for the Cooperative Membership ID Card.
 *
 * WHY: html2canvas cannot resolve Tailwind v4 CSS custom properties
 * (var(--color-*), color-mix()) on mobile browsers — causes blank/corrupt
 * canvas or throws on Android/iOS. Server-side generation has zero CSS,
 * CORS, or canvas constraints.
 *
 * OUTPUT: CR80 card (86mm × 54mm), landscape.
 *
 * LAYOUT (all units: mm):
 *   ┌──────────────────────────────────────────────────────────────────────────┐
 *   │ shimmer strip (h=1)                                                       │
 *   ├──────────────────────────────────────────────────────────────────────────┤
 *   │ EASY SALES EXPORT LTD       [MEMBER badge]    y=2..10                    │
 *   │ COOPERATIVE MEMBERSHIP                                                    │
 *   ├──────────────────────────────────────────────────────────────────────────┤
 *   │ [photo 18×24]  Full Name                      y=12..44                   │
 *   │                Member No                                                  │
 *   │                Gender      ___                                            │
 *   │                State       ___                                            │
 *   │                Issued      ___                                            │
 *   │                Valid Until ___                                            │
 *   ├──────────────────────────────────────────────────────────────────────────┤
 *   │ • • • • • • • • • • •  easysalesexport.com    y=45..53                  │
 *   └──────────────────────────────────────────────────────────────────────────┘
 */

import { NextRequest, NextResponse } from "next/server";
import { jsPDF } from "jspdf";
import { requireSession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtShort(iso: string): string {
    if (!iso) return "—";
    try {
        return new Intl.DateTimeFormat("en-NG", {
            year: "numeric",
            month: "short",
        }).format(new Date(iso));
    } catch {
        return iso;
    }
}

function capitalize(s: string): string {
    if (!s) return "—";
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Fetch a remote image → base64 data URI. Runs server-side, no CORS. */
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

// ── Layout constants (mm) ────────────────────────────────────────────────────

const W = 86;   // card width
const H = 54;   // card height
const PAD = 4;  // horizontal padding

const HEADER_H = 11;         // header section height
const FOOTER_H = 9;          // footer section height
const BODY_TOP = HEADER_H + 1;
const BODY_H = H - HEADER_H - FOOTER_H - 1;

const PHOTO_X = PAD;
const PHOTO_Y = BODY_TOP;
const PHOTO_W = 18;
const PHOTO_H = BODY_H;      // fills full body height

const DETAIL_X = PHOTO_X + PHOTO_W + 3;
const DETAIL_W = W - DETAIL_X - PAD;

// ── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return NextResponse.json({ error: "Authentication required" }, { status: 401 });
        }

        const data = await req.json();
        const {
            fullName = "",
            memberNumber = "",
            gender = "",
            stateOfOrigin = "",
            joinedAt = "",
            validUntil = "",
            passportPhotoUrl = null,
        } = data;

        // ── PDF canvas ───────────────────────────────────────────────────────
        const pdf = new jsPDF({
            orientation: "landscape",
            unit: "mm",
            format: [W, H],
        });

        // ── Background: 3-stop purple gradient simulation ────────────────────
        pdf.setFillColor(107, 33, 168);   // #6b21a8
        pdf.rect(0, 0, 30, H, "F");
        pdf.setFillColor(120, 30, 195);   // #7820c3
        pdf.rect(30, 0, 28, H, "F");
        pdf.setFillColor(55, 48, 163);    // #3730a3
        pdf.rect(58, 0, W - 58, H, "F");

        // ── Holographic shimmer strip (top 1mm) ──────────────────────────────
        pdf.setFillColor(255, 255, 255);
        pdf.setGState(new (pdf as any).GState({ opacity: 0.35 }));
        pdf.rect(0, 0, W, 1, "F");
        pdf.setGState(new (pdf as any).GState({ opacity: 1 }));

        // ── Header ───────────────────────────────────────────────────────────
        // Title
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(7);
        pdf.setTextColor(255, 255, 255);
        pdf.text("EASY SALES EXPORT LTD", PAD, 6);

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(4);
        pdf.setTextColor(200, 180, 255);
        pdf.text("COOPERATIVE MEMBERSHIP", PAD, 9.5);

        // MEMBER badge — top right
        const badgeW = 15;
        const badgeH = 5;
        const badgeX = W - PAD - badgeW;
        const badgeY = 3;
        pdf.setFillColor(196, 181, 253); // purple-300
        pdf.roundedRect(badgeX, badgeY, badgeW, badgeH, 1.2, 1.2, "F");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(4.5);
        pdf.setTextColor(88, 28, 135); // purple-900
        pdf.text("MEMBER", badgeX + badgeW / 2, badgeY + 3.3, { align: "center" });

        // Header divider
        pdf.setDrawColor(255, 255, 255);
        pdf.setLineWidth(0.2);
        pdf.setGState(new (pdf as any).GState({ opacity: 0.25 }));
        pdf.line(PAD, HEADER_H, W - PAD, HEADER_H);
        pdf.setGState(new (pdf as any).GState({ opacity: 1 }));

        // ── Passport photo ───────────────────────────────────────────────────
        let photoBase64: string | null = null;
        if (passportPhotoUrl) {
            photoBase64 = await fetchImageAsBase64(passportPhotoUrl);
        }

        // Photo border
        pdf.setDrawColor(255, 255, 255);
        pdf.setLineWidth(0.5);
        pdf.setGState(new (pdf as any).GState({ opacity: 0.5 }));
        pdf.roundedRect(PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H, 1, 1, "S");
        pdf.setGState(new (pdf as any).GState({ opacity: 1 }));

        if (photoBase64) {
            pdf.addImage(photoBase64, "JPEG", PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H);
        } else {
            pdf.setFillColor(120, 80, 200);
            pdf.roundedRect(PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H, 1, 1, "F");
            pdf.setTextColor(200, 180, 255);
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(4);
            pdf.text("No\nPhoto", PHOTO_X + PHOTO_W / 2, PHOTO_Y + PHOTO_H / 2 - 2, {
                align: "center",
            });
        }

        // ── Member details (right of photo) ──────────────────────────────────
        let dy = BODY_TOP + 4;

        // Full name
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(7.5);
        pdf.setTextColor(255, 255, 255);
        // Truncate long names to fit card width
        const maxNameW = DETAIL_W;
        let displayName = fullName || "—";
        while (
            pdf.getTextWidth(displayName) > maxNameW && displayName.length > 3
        ) {
            displayName = displayName.slice(0, -4) + "…";
        }
        pdf.text(displayName, DETAIL_X, dy);
        dy += 4.5;

        // Member number
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(4);
        pdf.setTextColor(180, 150, 240);
        pdf.text(memberNumber || "—", DETAIL_X, dy);
        dy += 5.5;

        // Divider under member number
        pdf.setDrawColor(255, 255, 255);
        pdf.setLineWidth(0.15);
        pdf.setGState(new (pdf as any).GState({ opacity: 0.2 }));
        pdf.line(DETAIL_X, dy - 1, W - PAD, dy - 1);
        pdf.setGState(new (pdf as any).GState({ opacity: 1 }));

        // Detail rows
        const rows: [string, string][] = [
            ["Gender",     capitalize(gender)],
            ["State",      stateOfOrigin || "—"],
            ["Issued",     fmtShort(joinedAt)],
            ["Valid Until", fmtShort(validUntil)],
        ];

        const ROW_H = 5.2;
        rows.forEach(([label, value]) => {
            // Label
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(4);
            pdf.setTextColor(160, 140, 220);
            pdf.text(label, DETAIL_X, dy);

            // Value — right-aligned
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(4.5);
            pdf.setTextColor(255, 255, 255);
            pdf.text(value, W - PAD, dy, { align: "right" });

            dy += ROW_H;
        });

        // ── Footer divider ───────────────────────────────────────────────────
        const footerY = H - FOOTER_H;
        pdf.setDrawColor(255, 255, 255);
        pdf.setLineWidth(0.15);
        pdf.setGState(new (pdf as any).GState({ opacity: 0.2 }));
        pdf.line(PAD, footerY, W - PAD, footerY);
        pdf.setGState(new (pdf as any).GState({ opacity: 1 }));

        // Dots
        const dotY = footerY + 4;
        for (let i = 0; i < 22; i++) {
            pdf.setFillColor(255, 255, 255);
            pdf.setGState(new (pdf as any).GState({ opacity: 0.22 }));
            pdf.circle(PAD + i * 3.5, dotY, 0.55, "F");
        }
        pdf.setGState(new (pdf as any).GState({ opacity: 1 }));

        // Website text
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(3.5);
        pdf.setTextColor(160, 140, 210);
        pdf.text("easysalesexport.com", W - PAD, dotY + 0.5, { align: "right" });

        // ── Output ───────────────────────────────────────────────────────────
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
