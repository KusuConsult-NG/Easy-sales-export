import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc, collection } from "firebase/firestore";

/**
 * API Route: Create Product Listing
 * Note: File uploads are simplified for now. In production, integrate with cloud storage
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

        // Check if user is an approved seller
        const sellerRef = doc(db, "marketplace_sellers", userId);
        const sellerDoc = await getDoc(sellerRef);

        if (!sellerDoc.exists() || sellerDoc.data().verificationStatus !== "approved") {
            return NextResponse.json(
                { success: false, message: "You must be an approved seller to list products" },
                { status: 403 }
            );
        }

        const formData = await request.formData();

        // Extract form fields
        const name = formData.get("name") as string;
        const category = formData.get("category") as string;
        const description = formData.get("description") as string;
        const specifications = formData.get("specifications") as string || "";
        const unit = formData.get("unit") as string;
        const minOrder = Number(formData.get("minOrder"));
        const stockQuantity = Number(formData.get("stockQuantity"));
        const retailPrice = Number(formData.get("retailPrice"));
        const bulkPrice = Number(formData.get("bulkPrice")) || 0;
        const exportPrice = Number(formData.get("exportPrice")) || 0;
        const certificationsStr = formData.get("certifications") as string;
        const certifications = certificationsStr ? JSON.parse(certificationsStr) : [];
        const escrowAvailable = formData.get("escrowAvailable") === "true";

        // Validate required fields
        if (!name || !category || !description || !unit || !minOrder || !stockQuantity || !retailPrice) {
            return NextResponse.json(
                { success: false, message: "Missing required fields" },
                { status: 400 }
            );
        }

        // Extract media files
        const images: string[] = [];
        let videoUrl = "";

        // Process images (simplified - in production, upload to cloud storage)
        for (let i = 0; i < 5; i++) {
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

        // Create product
        const productRef = doc(collection(db, "products"));
        const productData = {
            sellerId: userId,
            sellerName: sellerDoc.data().businessName || session.user.name,
            name,
            category,
            description,
            specifications,
            unit,
            minOrder,
            stockQuantity,
            pricingTiers: {
                retail: retailPrice,
                bulk: bulkPrice || retailPrice,
                export: exportPrice || retailPrice,
            },
            certifications,
            images,
            videoUrl,
            escrowAvailable,
            rating: 0,
            totalOrders: 0,
            status: "active",
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await setDoc(productRef, productData);

        return NextResponse.json({
            success: true,
            message: "Product listed successfully",
            productId: productRef.id
        });
    } catch (error) {
        console.error("Failed to create product:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
