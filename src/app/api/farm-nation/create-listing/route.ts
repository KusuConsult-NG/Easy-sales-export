import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc, collection } from "firebase/firestore";

/**
 * API Route: Create Land Listing
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

        // Get user details
        const userRef = doc(db, "users", userId);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
            return NextResponse.json(
                { success: false, message: "User not found" },
                { status: 404 }
            );
        }

        const formData = await request.formData();

        // Extract form fields
        const title = formData.get("title") as string;
        const category = formData.get("category") as string;
        const description = formData.get("description") as string;
        const state = formData.get("state") as string;
        const lga = formData.get("lga") as string;
        const address = formData.get("address") as string;
        const size = Number(formData.get("size"));
        const unit = formData.get("unit") as string;
        const pricePerUnit = Number(formData.get("pricePerUnit"));
        const totalPrice = Number(formData.get("totalPrice"));
        const latitude = formData.get("latitude") as string;
        const longitude = formData.get("longitude") as string;
        const availableForSale = formData.get("availableForSale") === "true";
        const availableForRent = formData.get("availableForRent") === "true";
        const escrowAvailable = formData.get("escrow Available") === "true";

        // Validate required fields
        if (!title || !category || !description || !state || !lga || !address ||
            !size || !unit || !pricePerUnit || !totalPrice) {
            return NextResponse.json(
                { success: false, message: "Missing required fields" },
                { status: 400 }
            );
        }

        // Extract media files
        const images: string[] = [];
        let videoUrl = "";

        // Process images (simplified - in production, upload to cloud storage)
        for (let i = 0; i < 8; i++) {
            const image = formData.get(`image${i}`) as File;
            if (image) {
                images.push(`placeholder_${image.name}`);
            }
        }

        // Process video
        const video = formData.get("video") as File;
        if (video) {
            videoUrl = `placeholder_${video.name}`;
        }

        // Process documents
        const documents: any = {};
        const landTitle = formData.get("landTitle") as File;
        const surveyPlan = formData.get("surveyPlan") as File;
        const taxClearance = formData.get("taxClearance") as File;

        if (landTitle) documents.landTitle = `placeholder_${landTitle.name}`;
        if (surveyPlan) documents.surveyPlan = `placeholder_${surveyPlan.name}`;
        if (taxClearance) documents.taxClearance = `placeholder_${taxClearance.name}`;

        // Validate documents
        if (!documents.landTitle || !documents.surveyPlan) {
            return NextResponse.json(
                { success: false, message: "Land title and survey plan are required" },
                { status: 400 }
            );
        }

        // Create GPS coordinates object
        const gpsCoordinates = latitude && longitude ? {
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude)
        } : null;

        // Create land listing
        const listingRef = doc(collection(db, "land_listings"));
        const listingData = {
            userId,
            ownerName: userDoc.data().name || userDoc.data().email,
            title,
            category,
            description,
            state,
            lga,
            address,
            size,
            unit,
            pricePerUnit,
            totalPrice,
            gpsCoordinates,
            images,
            videoUrl,
            documents,
            availableForSale,
            availableForRent,
            escrowAvailable,
            verificationStatus: "pending",
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await setDoc(listingRef, listingData);

        return NextResponse.json({
            success: true,
            message: "Land listing created successfully",
            listingId: listingRef.id
        });
    } catch (error) {
        console.error("Failed to create land listing:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
