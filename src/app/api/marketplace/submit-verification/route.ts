import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc, collection } from "firebase/firestore";

/**
 * API Route: Submit Seller Verification
 * Note: File uploads are simplified for now. In production, integrate with cloud storage (Firebase Storage/Cloudinary)
 */
export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const userId = session.user.id;

        // Check if user already has a verification request
        const existingVerificationQuery = await getDoc(doc(db, "seller_verifications", userId));
        if (existingVerificationQuery.exists()) {
            const existingData = existingVerificationQuery.data();
            if (existingData.status === "pending") {
                return NextResponse.json(
                    { success: false, message: "You already have a pending verification request" },
                    { status: 400 }
                );
            }
        }

        const formData = await request.formData();

        // Extract form fields
        const businessName = formData.get("businessName") as string;
        const businessType = formData.get("businessType") as string;
        const businessDescription = formData.get("businessDescription") as string;
        const phone = formData.get("phone") as string;
        const email = formData.get("email") as string;
        const address = formData.get("address") as string;
        const state = formData.get("state") as string;
        const lga = formData.get("lga") as string;
        const bankName = formData.get("bankName") as string;
        const accountNumber = formData.get("accountNumber") as string;
        const accountName = formData.get("accountName") as string;

        // In production: Upload files to Firebase Storage or Cloudinary
        // For now, we'll store placeholder URLs
        const businessDoc = formData.get("businessDoc") as File;
        const idDoc = formData.get("idDoc") as File;
        const addressProof = formData.get("addressProof") as File;

        // Validate required fields
        if (!businessName || !businessType || !businessDescription ||
            !phone || !email || !address || !state || !lga ||
            !bankName || !accountNumber || !accountName) {
            return NextResponse.json(
                { success: false, message: "Missing required fields" },
                { status: 400 }
            );
        }

        if (!businessDoc || !idDoc || !addressProof) {
            return NextResponse.json(
                { success: false, message: "All document uploads are required" },
                { status: 400 }
            );
        }

        // Create verification record
        const verificationRef = doc(db, "seller_verifications", userId);
        const verificationData = {
            userId,
            businessName,
            businessType,
            businessDescription,
            phone,
            email,
            address,
            state,
            lga,
            documents: {
                businessDoc: `placeholder_${businessDoc.name}`, // In production: actual storage URL
                idDoc: `placeholder_${idDoc.name}`,
                addressProof: `placeholder_${addressProof.name}`,
            },
            bankDetails: {
                bankName,
                accountNumber,
                accountName,
            },
            status: "pending",
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await setDoc(verificationRef, verificationData);

        // Update marketplace_sellers with pending status
        const sellerRef = doc(db, "marketplace_sellers", userId);
        await setDoc(sellerRef, {
            userId,
            verificationStatus: "pending",
            verificationId: userId,
            createdAt: new Date(),
        });

        return NextResponse.json({
            success: true,
            message: "Verification submitted successfully"
        });
    } catch (error) {
        console.error("Failed to submit verification:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
