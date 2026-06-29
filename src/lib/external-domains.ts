/**
 * External Domain Configuration
 * 
 * Configuration for dedicated domain redirects for each platform module
 */

export const EXTERNAL_DOMAINS = {
    marketplace: process.env.NEXT_PUBLIC_MARKETPLACE_URL || 'https://marketplace.easysalesexport.com',
    cooperatives: process.env.NEXT_PUBLIC_COOPERATIVES_URL || 'https://easysalescooperative.com',
    academy: process.env.NEXT_PUBLIC_ACADEMY_URL || 'https://easysalesacademy.com',
    wave: process.env.NEXT_PUBLIC_WAVE_URL || 'https://waveprogramme.com',
    export: process.env.NEXT_PUBLIC_EXPORT_URL || 'https://easysalesexportng.com',
    farmNation: process.env.NEXT_PUBLIC_FARM_NATION_URL || 'https://farmnation.ng',
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
