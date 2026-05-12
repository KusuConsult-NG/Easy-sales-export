const fs = require('fs');

let content = fs.readFileSync('src/components/admin/ImportLegacyModal.tsx', 'utf-8');

// 1. Add module to props
content = content.replace('interface ImportLegacyModalProps {', 'interface ImportLegacyModalProps {\n    module: "academy" | "export" | "wave" | "farmNation" | "cooperative";');

// 2. Add new state fields
const newStateFields = `        // Module Specific
        exportCompanyName: "",
        exportRcNumber: "",
        exportYearEstablished: "",
        exportBusinessType: "sole_proprietorship",
        exportIndustry: "agriculture",
        waveSurname: "",
        waveResidentialState: "",
        farmNationRole: "farmer" as "farmer" | "buyer" | "seller" | "both",
        farmNationFarmSize: "",
        farmNationCropTypes: "",
        cooperativeAmount: "",`;
content = content.replace('academyPlan: "foundation" as "foundation" | "standard" | "elite",', 'academyPlan: "foundation" as "foundation" | "standard" | "elite",\n' + newStateFields);

// 3. Update STEPS based on module
const newStepsLogic = `    const STEPS = ["Identity", "Location", "Next of Kin", "Documents", "Financial", "Module Details"];`;
content = content.replace('const STEPS = ["Identity", "Location", "Next of Kin", "Documents", "Financial", "Services"] as const;', '');
content = content.replace('export default function ImportLegacyModal({ isOpen, onClose, onSuccess }: ImportLegacyModalProps) {', 'export default function ImportLegacyModal({ isOpen, onClose, onSuccess, module }: ImportLegacyModalProps) {\n' + newStepsLogic);

// 4. Update handleSubmit to include module payload
const newPayloadLogic = `
        const payload: any = {
            fullName: formData.fullName,
            email: formData.email,
            phone: formData.phone,
            gender: formData.gender || undefined,
            dateOfBirth: formData.dateOfBirth || undefined,
            occupation: formData.occupation || undefined,
            roles,
            state: formData.state,
            lga: formData.lga,
            city: formData.city || undefined,
            address: formData.address,
            ...(formData.nextOfKinName ? { nextOfKinName: formData.nextOfKinName } : {}),
            ...(formData.nextOfKinPhone ? { nextOfKinPhone: formData.nextOfKinPhone } : {}),
            ...(formData.nextOfKinRelationship ? { nextOfKinRelationship: formData.nextOfKinRelationship } : {}),
            ...(formData.nextOfKinAddress ? { nextOfKinAddress: formData.nextOfKinAddress } : {}),
            ...(formData.validIdUrl ? { validIdUrl: formData.validIdUrl } : {}),
            ...(formData.passportPhotoUrl ? { passportPhotoUrl: formData.passportPhotoUrl } : {}),
            ...(formData.proofOfAddressUrl ? { proofOfAddressUrl: formData.proofOfAddressUrl } : {}),
            ...(formData.accountNumber ? { accountNumber: formData.accountNumber } : {}),
            ...(formData.accountName ? { accountName: formData.accountName } : {}),
            ...(formData.bankName ? { bankName: formData.bankName } : {}),
            ...(formData.bankCode ? { bankCode: formData.bankCode } : {}),
            ...(formData.nin ? { nin: formData.nin } : {}),
            ...(formData.bvn ? { bvn: formData.bvn } : {}),
            services: {
                cooperative: module === "cooperative",
                academy: module === "academy",
                marketplace: false,
                export: module === "export",
                wave: module === "wave",
                farmNation: module === "farmNation",
            },
        };

        if (module === "academy") {
            payload.academyPlan = formData.academyPlan;
        } else if (module === "export") {
            payload.exportInfo = {
                companyName: formData.exportCompanyName || undefined,
                rcNumber: formData.exportRcNumber || undefined,
                yearEstablished: formData.exportYearEstablished || undefined,
                businessType: formData.exportBusinessType || undefined,
                industry: formData.exportIndustry || undefined,
            };
        } else if (module === "wave") {
            payload.waveInfo = {
                surname: formData.waveSurname || undefined,
                residentialState: formData.waveResidentialState || undefined,
            };
        } else if (module === "farmNation") {
            payload.farmNationInfo = {
                role: formData.farmNationRole || undefined,
                farmSize: formData.farmNationFarmSize || undefined,
                cropTypes: formData.farmNationCropTypes ? formData.farmNationCropTypes.split(",") : undefined,
            };
        } else if (module === "cooperative") {
            payload.cooperativeInfo = {
                amount: formData.cooperativeAmount ? Number(formData.cooperativeAmount) : undefined,
            };
        }
`;

content = content.replace(/const payload = \{[\s\S]*?services: formData\.services,\n\s*\};/, newPayloadLogic);

// 5. Replace step 5 (Services) with Module Details UI
const moduleDetailsStep = `                    {step === 5 && (
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold text-slate-900 border-b pb-2 mb-4">
                                {module.toUpperCase()} Specific Details
                            </h3>
                            {module === "academy" && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Academy Plan</label>
                                    <select
                                        className="w-full border-slate-300 rounded-md shadow-sm"
                                        value={formData.academyPlan}
                                        onChange={(e) => field("academyPlan", e.target.value as any)}
                                    >
                                        <option value="foundation">Foundation</option>
                                        <option value="standard">Standard</option>
                                        <option value="elite">Elite</option>
                                    </select>
                                </div>
                            )}
                            {module === "export" && (
                                <>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Company Name</label>
                                            <input type="text" className="w-full border-slate-300 rounded-md shadow-sm" value={formData.exportCompanyName} onChange={e => field("exportCompanyName", e.target.value)} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">RC Number</label>
                                            <input type="text" className="w-full border-slate-300 rounded-md shadow-sm" value={formData.exportRcNumber} onChange={e => field("exportRcNumber", e.target.value)} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Year Established</label>
                                            <input type="text" className="w-full border-slate-300 rounded-md shadow-sm" value={formData.exportYearEstablished} onChange={e => field("exportYearEstablished", e.target.value)} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Business Type</label>
                                            <select className="w-full border-slate-300 rounded-md shadow-sm" value={formData.exportBusinessType} onChange={e => field("exportBusinessType", e.target.value as any)}>
                                                <option value="sole_proprietorship">Sole Proprietorship</option>
                                                <option value="llc">LLC</option>
                                                <option value="partnership">Partnership</option>
                                            </select>
                                        </div>
                                    </div>
                                </>
                            )}
                            {module === "wave" && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Surname</label>
                                        <input type="text" className="w-full border-slate-300 rounded-md shadow-sm" value={formData.waveSurname} onChange={e => field("waveSurname", e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Residential State</label>
                                        <input type="text" className="w-full border-slate-300 rounded-md shadow-sm" value={formData.waveResidentialState} onChange={e => field("waveResidentialState", e.target.value)} />
                                    </div>
                                </div>
                            )}
                            {module === "farmNation" && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
                                        <select className="w-full border-slate-300 rounded-md shadow-sm" value={formData.farmNationRole} onChange={e => field("farmNationRole", e.target.value as any)}>
                                            <option value="farmer">Farmer</option>
                                            <option value="buyer">Buyer</option>
                                            <option value="seller">Seller</option>
                                            <option value="both">Both</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Farm Size / Acreage</label>
                                        <input type="text" className="w-full border-slate-300 rounded-md shadow-sm" value={formData.farmNationFarmSize} onChange={e => field("farmNationFarmSize", e.target.value)} />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Crop/Listing Types (comma separated)</label>
                                        <input type="text" className="w-full border-slate-300 rounded-md shadow-sm" placeholder="Maize, Cassava, etc." value={formData.farmNationCropTypes} onChange={e => field("farmNationCropTypes", e.target.value)} />
                                    </div>
                                </div>
                            )}
                            {module === "cooperative" && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Initial Monthly Contribution (₦)</label>
                                    <input type="number" className="w-full border-slate-300 rounded-md shadow-sm" value={formData.cooperativeAmount} onChange={e => field("cooperativeAmount", e.target.value)} />
                                </div>
                            )}
                        </div>
                    )}`;

content = content.replace(/\{step === 5 && \([\s\S]*?Services[\s\S]*?\}\)/, moduleDetailsStep);

fs.writeFileSync('src/components/admin/ImportLegacyModal.tsx', content);
