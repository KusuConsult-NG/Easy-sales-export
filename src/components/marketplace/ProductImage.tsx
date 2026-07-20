"use client";

import { useState } from "react";
import Image from "next/image";
import { Package } from "lucide-react";

interface ProductImageProps {
    src: string | undefined;
    alt: string;
}

/**
 * ProductImage — client component that gracefully falls back to a
 * placeholder icon when an image URL is missing, a local/relative path,
 * or a broken external link.
 */
export default function ProductImage({ src, alt }: ProductImageProps) {
    const [errored, setErrored] = useState(false);

    // Treat missing src, relative paths (no http/https), or already-errored as fallback
    const isValid = src && !errored && (src.startsWith("http://") || src.startsWith("https://"));

    if (!isValid) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-slate-100 text-slate-400">
                <Package className="w-12 h-12" />
            </div>
        );
    }

    return (
        <Image
            src={src}
            alt={alt}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-500"
            sizes="(max-width: 768px) 100vw, 33vw"
            onError={() => setErrored(true)}
        />
    );
}
