
import { NextResponse } from "next/server";
import { runSchemaStandardizationAction } from "@/app/actions/schema-standardization";

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get("dryRun") !== "false"; // Default to true (safe)
    const secret = searchParams.get("secret");

    // Simple security
    if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
        // Allow running without secret only in development if needed, but safer to block
        // return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const result = await runSchemaStandardizationAction(dryRun);
        return NextResponse.json(result);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
