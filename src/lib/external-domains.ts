/**
 * External Domain Configuration
 * 
 * Configuration for dedicated domain redirects for each platform module
 */

export const EXTERNAL_DOMAINS = {
    marketplace: process.env.NEXT_PUBLIC_MARKETPLACE_URL || 'https://marketplace.easysales.com',
    cooperatives: process.env.NEXT_PUBLIC_COOPERATIVES_URL || 'https://cooperatives.easysales.com',
    academy: process.env.NEXT_PUBLIC_ACADEMY_URL || 'https://academy.easysales.com',
    wave: process.env.NEXT_PUBLIC_WAVE_URL || 'https://wave.easysales.com',
    export: process.env.NEXT_PUBLIC_EXPORT_URL || 'https://export.easysales.com',
    farmNation: process.env.NEXT_PUBLIC_FARM_NATION_URL || 'https://farmnation.easysales.com',
} as const;

export type ExternalDomain = keyof typeof EXTERNAL_DOMAINS;

/**
 * Get redirect URL for a specific module
 */
export function getModuleUrl(module: ExternalDomain, path: string = ''): string {
    const baseUrl = EXTERNAL_DOMAINS[module];
    return path ? `${baseUrl}${path}` : baseUrl;
}

/**
 * Redirect to external module domain
 */
export function redirectToModule(module: ExternalDomain, path: string = '') {
    const url = getModuleUrl(module, path);
    window.location.href = url;
}
