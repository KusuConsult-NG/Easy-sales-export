import type { Metadata } from 'next'
import { getAdminDb } from '@/lib/firebase-admin'

export const runtime = 'nodejs'

/**
 * Dynamic metadata for marketplace product pages at /marketplace/products/[id].
 * (Distinct from /marketplace/product/[id] — both routes exist in the codebase.)
 * The page is a Client Component, so metadata is exported from this layout.
 */
export async function generateMetadata(
    { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
    const { id } = await params

    try {
        const db = getAdminDb()
        const doc = await db.collection('products').doc(id).get()

        if (!doc.exists) {
            return {
                title: 'Product Not Found',
                description: 'This product is no longer available on Easy Sales Export.',
            }
        }

        const data = doc.data()!
        const title = data.title ?? 'Agricultural Export Product'
        const description = data.description
            ? String(data.description).slice(0, 160)
            : `Buy ${title} on Easy Sales Export — Nigeria's verified agricultural export marketplace.`
        const image = data.images?.[0] ?? '/images/logo.jpg'
        const price = data.pricingTiers?.[0]?.price

        const jsonLd = {
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: title,
            description,
            image,
            offers: price ? {
                '@type': 'Offer',
                price: String(price),
                priceCurrency: 'NGN',
                availability: data.status === 'approved' ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
                seller: { '@type': 'Organization', name: 'Easy Sales Export' },
            } : undefined,
        }

        return {
            title: `${title} | Easy Sales Export Marketplace`,
            description,
            openGraph: {
                type: 'website',
                title: `${title} | Easy Sales Export Marketplace`,
                description,
                url: `https://easysalesexport.com/marketplace/products/${id}`,
                images: [{ url: image, width: 800, height: 600, alt: title }],
            },
            twitter: {
                card: 'summary_large_image',
                title,
                description,
                images: [image],
            },
            other: {
                'application/ld+json': JSON.stringify(jsonLd),
            },
        }
    } catch {
        return {
            title: 'Agricultural Product | Easy Sales Export',
            description: "Best-quality agricultural export products from Nigeria's verified marketplace.",
        }
    }
}

export default function ProductsLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>
}
