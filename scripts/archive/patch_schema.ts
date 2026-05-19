import fs from 'fs';

let content = fs.readFileSync('src/lib/schemas.ts', 'utf-8');

const replacement = `    // Optional service-specific pre-approvals
    services: z.object({
        marketplace: z.boolean().default(false),
        export: z.boolean().default(false),
        cooperative: z.boolean().default(false),
        wave: z.boolean().default(false),
        academy: z.boolean().default(false),
        farmNation: z.boolean().default(false),
    }).optional(),
    exportInfo: z.object({
        companyName: z.string().optional(),
        rcNumber: z.string().optional(),
        yearEstablished: z.string().optional(),
        businessType: z.string().optional(),
        industry: z.string().optional(),
    }).optional(),
    farmNationInfo: z.object({
        role: z.enum(["buyer", "seller", "both"]).optional(),
        farmSize: z.string().optional(),
        cropTypes: z.string().optional(),
    }).optional(),
    waveInfo: z.object({
        residentialState: z.string().optional(),
        surname: z.string().optional(),
    }).optional(),
});`;

content = content.replace(/    \/\/ Optional service-specific pre-approvals[\s\S]*?\}\)\.optional\(\),\n\}\);/m, replacement);

fs.writeFileSync('src/lib/schemas.ts', content);
