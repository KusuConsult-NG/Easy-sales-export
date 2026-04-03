export const dynamic = 'force-dynamic';
import { NextResponse } from "next/server";
import { getUsersAction } from "@/app/actions/admin";

export async function GET() {
    try {
        const result = await getUsersAction({ limit: 5 });
        return NextResponse.json(result);
    } catch (error: any) {
        return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
    }
}
