import type { Metadata } from 'next'
import { getAdminDb } from '@/lib/firebase-admin'
import { COLLECTIONS } from "@/lib/types/firestore";

export const runtime = 'nodejs'

/**
 * Dynamic metadata for Academy course detail pages.
 * The page itself is a Client Component ("use client"), so metadata
 * must be exported from this layout file.
 */
export async function generateMetadata(
    { params }: { params: Promise<{ courseId: string }> }
): Promise<Metadata> {
    const { courseId } = await params

    try {
        const db = getAdminDb()
        const doc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get()

        if (!doc.exists) {
            return {
                title: 'Course Not Found',
                description: 'This course is no longer available on Easy Sales Academy.',
            }
        }

        const data = doc.data()!
        const title = data.title ?? 'Export Readiness Course'
        const description = data.description
            ? String(data.description).slice(0, 160)
            : `Learn export readiness with "${title}" on Easy Sales Academy — Nigeria's premier agro-export training platform.`
        const instructor = data.instructor ?? 'Easy Sales Academy'
        const duration = data.duration ?? ''

        const jsonLd = {
            '@context': 'https://schema.org',
            '@type': 'Course',
            name: title,
            description,
            provider: {
                '@type': 'Organization',
                name: 'Easy Sales Academy',
                sameAs: 'https://easysalesacademy.com',
            },
            instructor: {
                '@type': 'Person',
                name: instructor,
            },
            timeRequired: duration || undefined,
            inLanguage: 'en-NG',
            offers: {
                '@type': 'Offer',
                price: '0',
                priceCurrency: 'NGN',
                category: 'Free',
            },
        }

        return {
            title: `${title} | Easy Sales Academy`,
            description,
            openGraph: {
                type: 'website',
                title: `${title} | Easy Sales Academy`,
                description,
                url: `https://easysalesacademy.com/academy/${courseId}`,
                images: [{ url: '/images/og-banner.png', width: 1200, height: 630, alt: title }],
            },
            twitter: {
                card: 'summary_large_image',
                title: `${title} | Easy Sales Academy`,
                description,
                images: ['/images/og-banner.png'],
            },
            other: {
                'application/ld+json': JSON.stringify(jsonLd),
            },
        }
    } catch {
        return {
            title: 'Export Readiness Course | Easy Sales Academy',
            description: 'Build your agro-export skills with Easy Sales Academy. Courses on export documentation, trade compliance, and international market entry.',
        }
    }
}

export default function CourseLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>
}
