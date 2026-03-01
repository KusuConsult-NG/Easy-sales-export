import { MetadataRoute } from 'next'
import { headers } from 'next/headers'

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

    // Domain-specific sitemap URLs
    const sitemapMap: Record<string, string> = {
        'easysalesexport.com': 'https://easysalesexport.com/sitemap.xml',
        'www.easysalesexport.com': 'https://easysalesexport.com/sitemap.xml',
        'easysalesacademy.com': 'https://easysalesacademy.com/sitemap.xml',
        'www.easysalesacademy.com': 'https://easysalesacademy.com/sitemap.xml',
        'farmnation.ng': 'https://farmnation.ng/sitemap.xml',
        'www.farmnation.ng': 'https://farmnation.ng/sitemap.xml',
        'market.easysalesexport.com': 'https://market.easysalesexport.com/sitemap.xml',
        'wave.ng': 'https://wave.ng/sitemap.xml',
        'www.wave.ng': 'https://wave.ng/sitemap.xml',
    }

    const sitemap = sitemapMap[host] ?? 'https://easysalesexport.com/sitemap.xml'

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
