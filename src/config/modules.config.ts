/**
 * Master Module Configuration for Easy Sales Export Hub
 * 
 * Centralizes management for all 6 federated applications.
 */

export type ModuleConfig = {
    id: string;
    name: string;
    domain: string;
    slug: string;
    version: string; // e.g., '1.0.0'
    features: {
        hasAcademy: boolean;
        hasFinance: boolean;
        hasChat: boolean;
        hasListings?: boolean;
    };
    uploadLimits: {
        video: number; // in MB
        docs: number;  // in MB
    };
};

export const HUB_MODULES: Record<string, ModuleConfig> = {
    WAVE: {
        id: 'mod_wave_001',
        name: 'WAVE Program',
        domain: 'waveprogramme.com',
        slug: 'wave',
        version: '1.0.0',
        features: { hasAcademy: false, hasFinance: false, hasChat: true },
        uploadLimits: { video: 0, docs: 20 },
    },
    FINANCE: {
        id: 'mod_fin_001',
        name: 'Finance Tracker',
        domain: 'finance.easysalesexport.com',
        slug: 'finance',
        version: '1.0.0',
        features: { hasAcademy: false, hasFinance: true, hasChat: true },
        uploadLimits: { video: 0, docs: 100 },
    },
    ACADEMY: {
        id: 'mod_academy_001',
        name: 'Academy LMS',
        domain: 'easysalesacademy.com',
        slug: 'academy',
        version: '1.0.0',
        features: { hasAcademy: true, hasFinance: false, hasChat: true },
        uploadLimits: { video: 1024, docs: 50 },
    },
    COOPERATIVES: {
        id: 'mod_coop_001',
        name: 'Cooperative Society',
        domain: 'easysalescooperative.com',
        slug: 'cooperatives',
        version: '1.0.0',
        features: { hasAcademy: false, hasFinance: true, hasChat: true },
        uploadLimits: { video: 0, docs: 30 },
    },
    FARM_NATION: {
        id: 'mod_farm_001',
        name: 'Farm Nation',
        // #454 OWNER DECISION: farmnation.ng is the canonical domain.
        // easysalesmarket.com was already right; this was the only one that
        // disagreed with the deployment. middleware.ts keeps the two
        // easysalesexport.com spellings as aliases so old links still land.
        domain: 'farmnation.ng',
        slug: 'farm-nation',
        version: '1.0.0',
        features: { hasAcademy: true, hasFinance: false, hasChat: false, hasListings: true },
        uploadLimits: { video: 50, docs: 20 },
    },
    EXPORT: {
        id: 'mod_export_001',
        name: 'Export Hub',
        domain: 'easysalesexportng.com',
        slug: 'export',
        version: '1.0.0',
        features: { hasAcademy: false, hasFinance: true, hasChat: false },
        uploadLimits: { video: 0, docs: 50 },
    },
    MARKETPLACE: {
        id: 'mod_mkt_001',
        name: 'Marketplace',
        domain: 'easysalesmarket.com',
        slug: 'marketplace',
        version: '1.0.0',
        features: { hasAcademy: false, hasFinance: true, hasChat: true },
        uploadLimits: { video: 0, docs: 10 },
    },
};

export const getModuleBySlug = (slug: string) => {
    return Object.values(HUB_MODULES).find(m => m.slug === slug);
};

export const getModuleByDomain = (domain: string) => {
    return Object.values(HUB_MODULES).find(m => m.domain === domain);
};
