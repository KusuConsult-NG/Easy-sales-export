import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, storage } from "@/lib/firebase";
import { collection, addDoc, Timestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

/**
 * POST - Upload certificate
 */
export async function POST(request: NextRequest) {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        const formData = await request.formData();
        const file = formData.get("file") as File;

        if (!file) {
            return NextResponse.json(
                { success: false, error: "No file provided" },
                { status: 400 }
            );
        }

        // Validate file
        const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
        if (!allowedTypes.includes(file.type)) {
            return NextResponse.json(
                { success: false, error: "Invalid file type" },
                { status: 400 }
            );
        }

        // Upload to Firebase Storage
        const fileName = `${Date.now()}_${file.name}`;
        const storageRef = ref(storage, `certificates/${session.user.id}/${fileName}`);

        const buffer = await file.arrayBuffer();
        await uploadBytes(storageRef, buffer, { contentType: file.type });

        const fileUrl = await getDownloadURL(storageRef);

        // Save metadata to Firestore
        await addDoc(collection(db, "user_certificates"), {
            userId: session.user.id,
            fileName: file.name,
            fileUrl,
            fileType: file.type,
            uploadedBy: session.user.id,
            uploadedAt: Timestamp.now(),
        });

        return NextResponse.json({
            success: true,
            message: "Certificate uploaded successfully",
        });
    } catch (error: any) {
        console.error("Upload error:", error);
        return NextResponse.json(
            { success: false, error: "Upload failed" },
            { status: 500 }
        );
    }
}
