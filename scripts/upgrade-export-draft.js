const fs = require('fs');

// 1. Update page.tsx
let pageContent = fs.readFileSync('src/app/export/onboarding/page.tsx', 'utf-8');

const handleStepChangeInject = `
    function handleStepChange(stepData: any) {
        setFormData((prev: any) => {
            const next = { ...prev, ...stepData };
            if (!isRevisionMode) {
                const userId = session?.user?.id;
                if (userId) {
                    try { localStorage.setItem(\`export_draft_\${userId}\`, JSON.stringify({ step: currentStepId, data: next })); } catch { /* non-blocking */ }
                }
            }
            return next;
        });
    };
`;

pageContent = pageContent.replace('function handleNext(stepData: any) {', handleStepChangeInject + '\n    function handleNext(stepData: any) {');

pageContent = pageContent.replace(/<InvestmentProfileStep\s+onNext=\{handleNext\}\s+initialData=\{formData\.profile\}\s+\/>/, 
    '<InvestmentProfileStep\n                        onNext={handleNext}\n                        onChange={handleStepChange}\n                        initialData={formData.profile}\n                    />');

pageContent = pageContent.replace(/<KYCVerificationStep\s+onNext=\{handleNext\}\s+onBack=\{handleBack\}\s+initialData=\{formData\.kyc\}\s+\/>/,
    '<KYCVerificationStep\n                        onNext={handleNext}\n                        onBack={handleBack}\n                        onChange={handleStepChange}\n                        initialData={formData.kyc}\n                    />');

pageContent = pageContent.replace(/<BankAccountStep\s+onNext=\{handleNext\}\s+onBack=\{handleBack\}\s+initialData=\{formData\.bank\}\s+\/>/,
    '<BankAccountStep\n                        onNext={handleNext}\n                        onBack={handleBack}\n                        onChange={handleStepChange}\n                        initialData={formData.bank}\n                    />');

pageContent = pageContent.replace(/<TermsAcceptanceStep\s+onNext=\{handleNext\}\s+onBack=\{handleBack\}\s+initialData=\{formData\.terms\}\s+\/>/,
    '<TermsAcceptanceStep\n                        onNext={handleNext}\n                        onBack={handleBack}\n                        onChange={handleStepChange}\n                        initialData={formData.terms}\n                    />');

fs.writeFileSync('src/app/export/onboarding/page.tsx', pageContent);

// 2. Update InvestmentProfileStep.tsx
let profileContent = fs.readFileSync('src/app/export/onboarding/steps/InvestmentProfileStep.tsx', 'utf-8');
profileContent = profileContent.replace('initialData?: any;\n}', 'initialData?: any;\n    onChange?: (data: any) => void;\n}');
profileContent = profileContent.replace('export function InvestmentProfileStep({ onNext, initialData }: InvestmentProfileStepProps) {', 'export function InvestmentProfileStep({ onNext, onChange, initialData }: InvestmentProfileStepProps) {');
profileContent = profileContent.replace(/setFormData\(prev => \(\{ \.\.\.prev, \[field\]: value \}\)\);/, 
    `setFormData(prev => {
            const next = { ...prev, [field]: value };
            onChange?.({ profile: next });
            return next;
        });`);
fs.writeFileSync('src/app/export/onboarding/steps/InvestmentProfileStep.tsx', profileContent);

// 3. Update KYCVerificationStep.tsx
let kycContent = fs.readFileSync('src/app/export/onboarding/steps/KYCVerificationStep.tsx', 'utf-8');
kycContent = kycContent.replace('initialData?: any;\n}', 'initialData?: any;\n    onChange?: (data: any) => void;\n}');
kycContent = kycContent.replace('export function KYCVerificationStep({ onNext, onBack, initialData }: KYCVerificationStepProps) {', 'export function KYCVerificationStep({ onNext, onBack, onChange, initialData }: KYCVerificationStepProps) {');
kycContent = kycContent.replace(/const updateField = \(field: string, value: string\) => \{[\s\S]*?setFormData\(prev => \(\{[\s\S]*?\.\.\.prev,[\s\S]*?kycData: \{[\s\S]*?\.\.\.prev\.kycData,[\s\S]*?\[field\]: value[\s\S]*?\}[\s\S]*?\}\)\);[\s\S]*?\};/, 
    `const updateField = (field: string, value: string) => {
        setFormData(prev => {
            const next = {
                ...prev,
                kycData: {
                    ...prev.kycData,
                    [field]: value
                }
            };
            onChange?.({ kyc: next });
            return next;
        });
        if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }));
    };`);
fs.writeFileSync('src/app/export/onboarding/steps/KYCVerificationStep.tsx', kycContent);

// 4. Update BankAccountStep.tsx
let bankContent = fs.readFileSync('src/app/export/onboarding/steps/BankAccountStep.tsx', 'utf-8');
bankContent = bankContent.replace('initialData?: any;\n}', 'initialData?: any;\n    onChange?: (data: any) => void;\n}');
bankContent = bankContent.replace('export function BankAccountStep({ onNext, onBack, initialData }: BankAccountStepProps) {', 'export function BankAccountStep({ onNext, onBack, onChange, initialData }: BankAccountStepProps) {');
bankContent = bankContent.replace(/const set = \(field: string, value: string\) => \{[\s\S]*?setFormData\(prev => \(\{ \.\.\.prev, \[field\]: value \}\)\);[\s\S]*?if \(errors\[field\]\) setErrors\(prev => \(\{ \.\.\.prev, \[field\]: '' \}\)\);[\s\S]*?\};/, 
    `const set = (field: string, value: string) => {
        setFormData(prev => {
            const next = { ...prev, [field]: value };
            onChange?.({ bank: next });
            return next;
        });
        if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }));
    };`);
fs.writeFileSync('src/app/export/onboarding/steps/BankAccountStep.tsx', bankContent);

// 5. Update TermsAcceptanceStep.tsx
let termsContent = fs.readFileSync('src/app/export/onboarding/steps/TermsAcceptanceStep.tsx', 'utf-8');
termsContent = termsContent.replace('initialData?: any;\n}', 'initialData?: any;\n    onChange?: (data: any) => void;\n}');
termsContent = termsContent.replace('export function TermsAcceptanceStep({ onNext, onBack, initialData }: TermsAcceptanceStepProps) {', 'export function TermsAcceptanceStep({ onNext, onBack, onChange, initialData }: TermsAcceptanceStepProps) {');
termsContent = termsContent.replace('setAccepted(e.target.checked);', 'setAccepted(e.target.checked);\n        onChange?.({ terms: { accepted: e.target.checked } });');
fs.writeFileSync('src/app/export/onboarding/steps/TermsAcceptanceStep.tsx', termsContent);
