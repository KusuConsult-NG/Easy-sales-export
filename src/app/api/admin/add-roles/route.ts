/**
 * Add comprehensive roles to user account for full platform access
 * This is a Next.js API route - call it via HTTP
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export async function POST(request: NextRequest) {
    try {
        const { email } = await request.json();

        if (!email) {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 });
        }

        console.log(`🔍 Finding user with email: ${email}`);

        // Get Firestore instance
        const adminDb = getAdminDb();

        // Find user by email
        const usersRef = adminDb.collection('users');
        const snapshot = await usersRef.where('email', '==', email).limit(1).get();

        if (snapshot.empty) {
            return NextResponse.json({ error: `User with email ${email} not found` }, { status: 404 });
        }

        const userDoc = snapshot.docs[0];
        const userId = userDoc.id;
        const currentData = userDoc.data();

        console.log(`✅ Found user: ${userId}`);
        console.log(`📋 Current roles:`, currentData.roles || []);

        // Add all roles for full platform access
        const allRoles = [
            "general_user",       // Dashboard, Academy
            "buyer",              // Marketplace buying
            "seller",             // Marketplace selling
            "export_participant", // Export Windows
            "cooperative_member", // Cooperatives
            "farmer",             // Farm Nation
            "land_owner",         // Farm Nation
            "investor",           // Farm Nation
        ];

        await userDoc.ref.update({
            roles: allRoles,
            updatedAt: new Date(),
        });

        console.log(`✅ Successfully updated roles for: ${email}`);

        return NextResponse.json({
            success: true,
            userId,
            email,
            oldRoles: currentData.roles || [],
            newRoles: allRoles,
            message: 'Roles updated successfully. Please logout and login again.'
        });

    } catch (error: any) {
        console.error('❌ Error adding roles:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
