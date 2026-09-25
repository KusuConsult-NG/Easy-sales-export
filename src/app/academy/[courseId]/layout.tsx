import type { Metadata } from 'next'
import { getAdminDb } from '@/lib/firebase-admin'
import { COLLECTIONS } from "@/lib/types/firestore";
import { courseOfferFor, courseTimeRequired } from '@/lib/academy-course-offer'

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

        /*
         *   #932 THE OFFER IS READ OFF THE COURSE, and may be absent.
         *
         *   What stood here was `price: '0', category: 'Free'` as a literal, on
         *   every course — including the ones _ac_course_payment charges for and
         *   the ones checkCourseAccess refuses without a paid plan. A price in
         *   structured data is a claim to third parties, and a rich result
         *   cannot be read in context the way a page can.
         *
         *   lib/academy-course-offer decides it, and says nothing at all for a
         *   course that is neither free nor individually priced — because the
         *   plan fee is not this course's price either.
         */
        const offers = courseOfferFor({ price: data.price, tier: data.tier })
        //   ISO 8601 or omitted. "4 weeks" in timeRequired is a value consumers
        //   discard, so emitting it was effort spent on nothing.
        const timeRequired = courseTimeRequired(data.duration)

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
            timeRequired,
            inLanguage: 'en-NG',
            //   Absent for a plan-gated course: JSON.stringify drops an
            //   undefined value, which is the "say nothing" schema.org allows.
            offers,
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
