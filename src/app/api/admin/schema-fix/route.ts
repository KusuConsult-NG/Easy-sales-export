
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { runSchemaStandardizationAction } from "@/app/actions/schema-standardization";

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get("dryRun") !== "false"; // Default to true (safe)
    
    // Read secret from Authorization header: Bearer <secret>
    const authHeader = request.headers.get("authorization");
    const secret = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

    // 🔒 SECURITY: Require CRON_SECRET or authenticated super_admin
    const hasValidSecret = process.env.CRON_SECRET && secret === process.env.CRON_SECRET;

    if (!hasValidSecret) {
        // Fall back to session-based auth for admin users
        const session = (await requireSession()).session;
        if (!session?.user?.roles?.includes("super_admin")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
    }

    try {
        const result = await runSchemaStandardizationAction(dryRun);
        return NextResponse.json(result);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
