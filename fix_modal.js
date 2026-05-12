const fs = require('fs');

let content = fs.readFileSync('src/components/admin/ImportLegacyModal.tsx', 'utf-8');

// Move STEPS outside
content = content.replace('type Step = (typeof STEPS)[number];\n\nexport default function ImportLegacyModal({ isOpen, onClose, onSuccess, module }: ImportLegacyModalProps) {\n    const STEPS = ["Identity", "Location", "Next of Kin", "Documents", "Financial", "Module Details"];', 'const STEPS = ["Identity", "Location", "Next of Kin", "Documents", "Financial", "Module Details"] as const;\ntype Step = (typeof STEPS)[number];\n\nexport default function ImportLegacyModal({ isOpen, onClose, onSuccess, module }: ImportLegacyModalProps) {');

// Fix setFormData in complete method
const newClearForm = `        setFormData({
            fullName: "", email: "", phone: "", gender: "",
            dateOfBirth: "", occupation: "", state: "", lga: "",
            city: "", address: "", nextOfKinName: "", nextOfKinPhone: "",
            nextOfKinRelationship: "", nextOfKinAddress: "", validIdUrl: "",
            passportPhotoUrl: "", proofOfAddressUrl: "", accountNumber: "",
            accountName: "", bankName: "", bankCode: "", nin: "", bvn: "",
            academyPlan: "foundation" as "foundation" | "standard" | "elite",
            exportCompanyName: "", exportRcNumber: "", exportYearEstablished: "",
            exportBusinessType: "sole_proprietorship", exportIndustry: "agriculture",
            waveSurname: "", waveResidentialState: "",
            farmNationRole: "farmer" as "farmer" | "buyer" | "seller" | "both",
            farmNationFarmSize: "", farmNationCropTypes: "",
            cooperativeAmount: "",
            services: {
                marketplace: false, export: false, cooperative: false,
                wave: false, academy: false, farmNation: false,
            },
        });`;

content = content.replace(/setFormData\(\{[\s\S]*?\}\);/m, newClearForm);

fs.writeFileSync('src/components/admin/ImportLegacyModal.tsx', content);

// Now patch the 5 page files
const pagesToPatch = [
  { file: 'src/app/admin/academy/applications/page.tsx', moduleName: 'academy' },
  { file: 'src/app/admin/export/applications/page.tsx', moduleName: 'export' },
  { file: 'src/app/admin/farm-nation/applications/page.tsx', moduleName: 'farmNation' },
  { file: 'src/app/admin/wave/members/page.tsx', moduleName: 'wave' },
  { file: 'src/app/admin/cooperatives/members/page.tsx', moduleName: 'cooperative' },
];

for (const p of pagesToPatch) {
  if (fs.existsSync(p.file)) {
    let pContent = fs.readFileSync(p.file, 'utf-8');
    pContent = pContent.replace(/<ImportLegacyModal\s+isOpen=\{isImportModalOpen\}\s+onClose=\{\(\) => setIsImportModalOpen\(false\)\}\s+onSuccess=\{\(\) => \{[\s\S]*?\}\}\s+\/>/, `<ImportLegacyModal\n                isOpen={isImportModalOpen}\n                onClose={() => setIsImportModalOpen(false)}\n                onSuccess={() => {\n                    setIsImportModalOpen(false);\n                    loadApplications ? loadApplications() : loadMembers?.();\n                }}\n                module="${p.moduleName}"\n            />`);
    fs.writeFileSync(p.file, pContent);
  }
}
