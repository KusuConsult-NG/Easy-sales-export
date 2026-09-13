import type { Metadata } from 'next'
import { readLandLocation, landLocationText } from '@/lib/land-location'
import { getAdminDb } from '@/lib/firebase-admin'
import { COLLECTIONS } from "@/lib/types/firestore";

export const runtime = 'nodejs'

/**
 * Dynamic metadata for Farm Nation property detail pages.
 * The page itself is a Client Component ("use client"), so metadata
 * must live in this layout file.
 */
export async function generateMetadata(
    { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
    const { id } = await params

    try {
        const db = getAdminDb()
        const doc = await db.collection(COLLECTIONS.LAND_LISTINGS).doc(id).get()

        if (!doc.exists) {
            return {
                title: 'Property Not Found',
                description: 'This land listing is no longer available on Farm Nation.',
            }
        }

        const data = doc.data()!
        const title = data.title ?? 'Agricultural Land Listing'
        /*
         *   #689 The fifth copy of the shape rule, and the one with the widest
         *   audience — this is the page's OpenGraph title and its
         *   schema.org RealEstateListing, which is what a search engine and a
         *   shared link show. It read `data.location.lga` behind a truthiness
         *   check on `location`, so a row written by
         *   /api/farm-nation/create-listing — which stores no `location` at all
         *   — was published as "Nigeria" with no address at all.
         */
        const place = readLandLocation(data)
        const location = landLocationText(data) || 'Nigeria'
        const description = data.description
            ? String(data.description).slice(0, 160)
            : `${data.size ?? ''} hectares of farmland in ${location}. Available on Farm Nation.`
        const image = data.images?.[0] ?? '/images/logo.jpg'
        const price = data.price

        const jsonLd = {
            '@context': 'https://schema.org',
            '@type': 'RealEstateListing',
            name: title,
            description,
            image,
            address: {
                '@type': 'PostalAddress',
                addressLocality: place.lga || undefined,
                addressRegion: place.state || undefined,
                addressCountry: 'NG',
            },
            offers: price ? {
                '@type': 'Offer',
                price: String(price),
                priceCurrency: 'NGN',
                availability: 'https://schema.org/InStock',
            } : undefined,
        }

        return {
            title: `${title} | Farm Nation`,
            description,
            openGraph: {
                type: 'website',
                title: `${title} | Farm Nation`,
                description,
                url: `https://farmnation.ng/farm-nation/property/${id}`,
                images: [{ url: image, width: 800, height: 600, alt: title }],
            },
            twitter: {
                card: 'summary_large_image',
                title: `${title} | Farm Nation`,
                description,
                images: [image],
            },
            other: {
                'application/ld+json': JSON.stringify(jsonLd),
            },
        }
    } catch {
        return {
            title: 'Farmland Listing | Farm Nation Nigeria',
            description: 'Discover verified agricultural land listings in Nigeria on Farm Nation.',
        }
    }
}

export default function PropertyLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>
}
