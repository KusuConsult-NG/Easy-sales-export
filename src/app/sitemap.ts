export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { MetadataRoute } from 'next'
import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { ROOT_ORIGIN } from "@/lib/canonical-host";
import { HUB_MODULES } from "@/config/modules.config";
import { isPublicPath } from "@/lib/route-manifest";

/*
 *   #902 THE SITEMAP ADVERTISED EIGHT HUNDRED REDIRECTS.
 *
 *   Every url below — the ten static routes, and one per approved product,
 *   verified land listing and published course — was built on the APEX, which
 *   this platform's own middleware 301s to `www` for the session reason in
 *   lib/canonical-host. A crawler was handed a redirect for every page the
 *   site wanted indexed, and the canonical tags on those pages named the same
 *   redirecting host.
 *
 *   The five OTHER domains below are unchanged and are NOT the same case:
 *   their canonical host is the apex, by modules.config's own declaration, and
 *   the middleware sends www -> apex for them. See MODULE_WWW_REDIRECTS.
 */
const BASE_URL = ROOT_ORIGIN
/**
 * The module domains, DERIVED — #902.
 *
 *   TWO OF THE FIVE HAND-WRITTEN ONES WERE NOT DOMAINS THIS PLATFORM SERVES,
 *   and one module was missing entirely. Measured against modules.config, which
 *   is what middleware's DOMAIN_MAP is built from:
 *
 *       wave.ng                          config says waveprogramme.com
 *       marketplace.easysalesexport.com  config says easysalesmarket.com
 *       easysalescooperative.com         in the config, ABSENT from the sitemap
 *
 *   Neither of the first two is in DOMAIN_MAP, so the middleware cannot map
 *   either to a module — a crawler following them does not reach the WAVE or
 *   Marketplace site at all. And the cooperative domain, which IS served, was
 *   never offered for indexing.
 *
 *   #454 recorded exactly this failure mode when it deleted an APEX_DOMAINS
 *   constant: "a list named APEX_DOMAINS is exactly the thing somebody reaches
 *   for when adding a redirect, and it would have been silently out of date."
 *   This was that list, and it was silently out of date. So it is derived from
 *   the same config the middleware routes by, and the module added next year is
 *   covered without anybody remembering.
 *
 *   FILTERED BY WHETHER THE MODULE HAS A PUBLIC LANDING PAGE. HUB_MODULES also
 *   holds FINANCE at finance.easysalesexport.com, and there is no `src/app/finance`
 *   in this application at all — offering it for indexing would publish a 404.
 *   isPublicPath is the platform's own answer to "may a stranger open this".
 */
const MODULE_URLS: MetadataRoute.Sitemap = Object.values(HUB_MODULES)
    .filter((mod) => isPublicPath(`/${mod.slug}`))
    .map((mod) => ({
        url: `https://${mod.domain}`,
        lastModified: new Date('2026-02-01'),
        changeFrequency: 'weekly' as const,
        priority: 0.9,
    }))

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
    // Custom domain canonical pages — derived, see MODULE_URLS.
    ...MODULE_URLS,
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
