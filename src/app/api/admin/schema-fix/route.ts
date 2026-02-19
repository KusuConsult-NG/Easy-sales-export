
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runSchemaStandardizationAction } from "@/app/actions/schema-standardization";

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get("dryRun") !== "false"; // Default to true (safe)
    const secret = searchParams.get("secret");

    // 🔒 SECURITY: Require CRON_SECRET or authenticated super_admin
    const hasValidSecret = process.env.CRON_SECRET && secret === process.env.CRON_SECRET;

    if (!hasValidSecret) {
        // Fall back to session-based auth for admin users
        const session = await auth();
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
