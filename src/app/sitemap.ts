export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { MetadataRoute } from 'next'
import { getAdminDb } from '@/lib/firebase-admin'
import { COLLECTIONS } from "@/lib/types/firestore";

const BASE_URL = 'https://easysalesexport.com'
const ACADEMY_URL = 'https://easysalesacademy.com'
const FARM_NATION_URL = 'https://farmnation.ng'
const MARKETPLACE_URL = 'https://marketplace.easysalesexport.com'
const WAVE_URL = 'https://wave.ng'

// Static public routes (no auth required)
const STATIC_ROUTES: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: new Date('2026-02-01'), changeFrequency: 'monthly', priority: 1.0 },
    { url: `${BASE_URL}/about`, lastModified: new Date('2026-02-01'), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/privacy`, lastModified: new Date('2026-01-01'), changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE_URL}/terms`, lastModified: new Date('2026-01-01'), changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE_URL}/cooperatives`, lastModified: new Date('2026-02-01'), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/marketplace`, lastModified: new Date('2026-02-01'), changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE_URL}/farm-nation`, lastModified: new Date('2026-02-01'), changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE_URL}/academy`, lastModified: new Date('2026-02-01'), changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE_URL}/export`, lastModified: new Date('2026-02-01'), changeFrequency: 'weekly', priority: 0.8 },
    // Sub-domain canonical pages
    { url: `${ACADEMY_URL}`, lastModified: new Date('2026-02-01'), changeFrequency: 'monthly', priority: 0.9 },
    { url: `${FARM_NATION_URL}`, lastModified: new Date('2026-02-01'), changeFrequency: 'monthly', priority: 0.9 },
    { url: `${MARKETPLACE_URL}`, lastModified: new Date('2026-02-01'), changeFrequency: 'weekly', priority: 0.9 },
    { url: `${WAVE_URL}`, lastModified: new Date('2026-02-01'), changeFrequency: 'monthly', priority: 0.8 },
]

export const revalidate = 600 // Regenerate sitemap every 10 minutes (was 1 hour)

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    try {
        const db = getAdminDb()

        // Fetch approved marketplace products — collection is 'products' (not 'marketplace_products')
        const productsSnap = await db
            .collection(COLLECTIONS.PRODUCTS)
            .where('status', '==', 'approved')
            .select('updatedAt', 'createdAt')
            .limit(500)
            .get()

        const productUrls: MetadataRoute.Sitemap = productsSnap.docs.map((doc) => {
            const data = doc.data()
            const lastMod = data.updatedAt?.toDate?.() ?? data.createdAt?.toDate?.() ?? new Date()
            return {
                url: `${BASE_URL}/marketplace/products/${doc.id}`,
                lastModified: lastMod,
                changeFrequency: 'weekly' as const,
                priority: 0.85,
            }
        })

        // Fetch verified land listings
        const landSnap = await db
            .collection(COLLECTIONS.LAND_LISTINGS)
            .where('status', '==', 'verified')
            .select('updatedAt', 'createdAt')
            .limit(200)
            .get()

        const landUrls: MetadataRoute.Sitemap = landSnap.docs.map((doc) => {
            const data = doc.data()
            const lastMod = data.updatedAt?.toDate?.() ?? data.createdAt?.toDate?.() ?? new Date()
            return {
                url: `${BASE_URL}/farm-nation/property/${doc.id}`,
                lastModified: lastMod,
                changeFrequency: 'weekly' as const,
                priority: 0.8,
            }
        })

        // Fetch published academy courses
        const coursesSnap = await db
            .collection(COLLECTIONS.ACADEMY_COURSES)
            .where('status', '==', 'published')
            .select('updatedAt', 'createdAt')
            .limit(100)
            .get()

        const courseUrls: MetadataRoute.Sitemap = coursesSnap.docs.map((doc) => {
            const data = doc.data()
            const lastMod = data.updatedAt?.toDate?.() ?? data.createdAt?.toDate?.() ?? new Date()
            return {
                url: `${BASE_URL}/academy/${doc.id}`,
                lastModified: lastMod,
                changeFrequency: 'monthly' as const,
                priority: 0.75,
            }
        })

        return [...STATIC_ROUTES, ...productUrls, ...landUrls, ...courseUrls]
    } catch (error) {
        // If Firestore fails, return static routes so sitemap is never broken
        console.error('[sitemap] Dynamic fetch failed, returning static routes:', error)
        return STATIC_ROUTES
    }
}
