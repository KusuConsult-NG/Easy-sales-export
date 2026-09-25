import { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { ROOT_ORIGIN } from '@/lib/canonical-host'
import { HUB_MODULES } from '@/config/modules.config'
import { isPublicPath } from '@/lib/route-manifest'

/**
 * Multi-Domain robots.txt
 *
 * This single handler covers all 5 platform domains. Next.js routes
 * robots.txt based on the Host header, so we can serve domain-specific
 * rules from a single function. Admin and dashboard routes are disallowed
 * on all domains; each domain's sitemap is explicitly linked.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
    const headersList = await headers()
    const host = headersList.get('host') ?? 'easysalesexport.com'

    /*
     *   #902 DERIVED FROM THE CONFIG THE MIDDLEWARE ROUTES BY.
     *
     *   Two of the five hand-written module hosts were not hosts this platform
     *   serves — `wave.ng` (config: waveprogramme.com) and
     *   `marketplace.easysalesexport.com` (config: easysalesmarket.com) — so a
     *   crawler arriving on either REAL module domain fell through to the `??`
     *   below and was handed the HUB's sitemap. The cooperative domain was
     *   absent altogether. See app/sitemap.ts for the full measurement and for
     *   #454's recorded warning about exactly this kind of list.
     *
     *   Each module gets its own apex, plus the `www` spelling the middleware
     *   redirects from — a crawler that lands on www should be told the sitemap
     *   on the host it is about to be sent to, which is the mistake the hub
     *   pair below used to make in the other direction.
     */
    const sitemapMap: Record<string, string> = {
        'easysalesexport.com': `${ROOT_ORIGIN}/sitemap.xml`,
        'www.easysalesexport.com': `${ROOT_ORIGIN}/sitemap.xml`,
    }
    for (const mod of Object.values(HUB_MODULES)) {
        if (!isPublicPath(`/${mod.slug}`)) continue;
        sitemapMap[mod.domain] = `https://${mod.domain}/sitemap.xml`
        //   Only for an apex: there is no `www.finance.easysalesexport.com`,
        //   and inventing one would name a host nobody has.
        if (mod.domain.split('.').length === 2) {
            sitemapMap[`www.${mod.domain}`] = `https://${mod.domain}/sitemap.xml`
        }
    }

    const sitemap = sitemapMap[host] ?? `${ROOT_ORIGIN}/sitemap.xml`

    return {
        rules: [
            {
                userAgent: '*',
                allow: '/',
                disallow: [
                    '/admin/',
                    '/dashboard/',
                    '/api/',
                    '/auth/',
                    '/_next/',
                ],
            },
            // Block AI training crawlers
            { userAgent: 'GPTBot', disallow: ['/'] },
            { userAgent: 'CCBot', disallow: ['/'] },
            { userAgent: 'anthropic-ai', disallow: ['/'] },
            { userAgent: 'ClaudeBot', disallow: ['/'] },
            { userAgent: 'Bytespider', disallow: ['/'] },
            { userAgent: 'Amazonbot', disallow: ['/'] },
            { userAgent: 'PerplexityBot', disallow: ['/'] },
            { userAgent: 'Applebot-Extended', disallow: ['/'] },
            { userAgent: 'Diffbot', disallow: ['/'] },
        ],
        sitemap,
    }
}
