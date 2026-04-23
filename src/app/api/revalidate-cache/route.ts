import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path') || '/admin/academy';
    
    try {
        revalidatePath(path);
        revalidatePath('/academy');
        revalidatePath('/dashboard/academy');
        return NextResponse.json({ revalidated: true, now: Date.now(), path });
    } catch (err) {
        return NextResponse.json({ revalidated: false, message: 'Error revalidating' }, { status: 500 });
    }
}
