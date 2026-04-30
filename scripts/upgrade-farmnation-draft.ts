import fs from 'fs';

// 1. Update page.tsx
let pageContent = fs.readFileSync('src/app/farm-nation/onboarding/page.tsx', 'utf-8');

const handleStepChangeInject = `
    function handleStepChange(stepData: any) {
        setFormData((prev: any) => {
            const next = { ...prev, ...stepData };
            if (!isRevisionMode) {
                const userId = session?.user?.id;
                if (userId) {
                    try { localStorage.setItem(\`farmnation_draft_\${userId}\`, JSON.stringify({ step: currentStepId, data: next })); } catch { /* non-blocking */ }
                }
            }
            return next;
        });
    };
`;

pageContent = pageContent.replace('function handleNext(stepData: any) {', handleStepChangeInject + '\n    function handleNext(stepData: any) {');

pageContent = pageContent.replace(/<RoleSelectionStep\s+onNext=\{handleNext\}\s+initialData=\{formData\.role\}\s+\/>/, 
    '<RoleSelectionStep\n                        onNext={handleNext}\n                        onChange={handleStepChange}\n                        initialData={formData.role}\n                    />');

pageContent = pageContent.replace(/<ProfileStep\s+onNext=\{handleNext\}\s+onBack=\{handleBack\}\s+initialData=\{formData\.profile\}\s+\/>/,
    '<ProfileStep\n                        onNext={handleNext}\n                        onBack={handleBack}\n                        onChange={handleStepChange}\n                        initialData={formData.profile}\n                    />');

pageContent = pageContent.replace(/<InterestsStep\s+onNext=\{handleNext\}\s+onBack=\{handleBack\}\s+initialData=\{formData\.interests\}\s+role=\{formData\.role\}\s+\/>/,
    '<InterestsStep\n                        onNext={handleNext}\n                        onBack={handleBack}\n                        onChange={handleStepChange}\n                        initialData={formData.interests}\n                        role={formData.role}\n                    />');

pageContent = pageContent.replace(/<TermsStep\s+onNext=\{handleNext\}\s+onBack=\{handleBack\}\s+initialData=\{formData\.terms\}\s+\/>/,
    '<TermsStep\n                        onNext={handleNext}\n                        onBack={handleBack}\n                        onChange={handleStepChange}\n                        initialData={formData.terms}\n                    />');

fs.writeFileSync('src/app/farm-nation/onboarding/page.tsx', pageContent);

// 2. Update ProfileStep.tsx
let profileContent = fs.readFileSync('src/app/farm-nation/onboarding/steps/ProfileStep.tsx', 'utf-8');
profileContent = profileContent.replace('initialData?: any;\n}', 'initialData?: any;\n    onChange?: (data: any) => void;\n}');
profileContent = profileContent.replace('export default function ProfileStep({ onNext, onBack, initialData }: ProfileStepProps) {', 'export default function ProfileStep({ onNext, onBack, onChange, initialData }: ProfileStepProps) {');
profileContent = profileContent.replace(/setFormData\(prev => \(\{ \.\.\.prev, \[field\]: value, \.\.\.\(field === 'state' \? \{ lga: '' \} : \{\}\) \}\)\);/, 
    `setFormData(prev => {
            const next = { ...prev, [field]: value, ...(field === 'state' ? { lga: '' } : {}) };
            onChange?.({ profile: next });
            return next;
        });`);
fs.writeFileSync('src/app/farm-nation/onboarding/steps/ProfileStep.tsx', profileContent);

// 3. Update RoleSelectionStep.tsx
let roleContent = fs.readFileSync('src/app/farm-nation/onboarding/steps/RoleSelectionStep.tsx', 'utf-8');
roleContent = roleContent.replace('initialData?: RoleType;\n}', 'initialData?: RoleType;\n    onChange?: (data: any) => void;\n}');
roleContent = roleContent.replace('export default function RoleSelectionStep({ onNext, initialData }: RoleSelectionStepProps) {', 'export default function RoleSelectionStep({ onNext, onChange, initialData }: RoleSelectionStepProps) {');
roleContent = roleContent.replace('setSelectedRole(role);', 'setSelectedRole(role);\n        onChange?.({ role });');
fs.writeFileSync('src/app/farm-nation/onboarding/steps/RoleSelectionStep.tsx', roleContent);

// 4. Update InterestsStep.tsx
let interestsContent = fs.readFileSync('src/app/farm-nation/onboarding/steps/InterestsStep.tsx', 'utf-8');
interestsContent = interestsContent.replace('initialData?: any;\n}', 'initialData?: any;\n    onChange?: (data: any) => void;\n}');
interestsContent = interestsContent.replace('export default function InterestsStep({ onNext, onBack, role, initialData }: InterestsStepProps) {', 'export default function InterestsStep({ onNext, onBack, onChange, role, initialData }: InterestsStepProps) {');
interestsContent = interestsContent.replace('setFormData(prev => ({ ...prev, [field]: value }));', 
    `setFormData(prev => {
            const next = { ...prev, [field]: value };
            onChange?.({ interests: next });
            return next;
        });`);
interestsContent = interestsContent.replace(/const toggleArrayItem = \(field: keyof typeof formData, value: string\) => \{[\s\S]*?setFormData\(prev => \(\{[\s\S]*?\.\.\.prev,[\s\S]*?\[field\]: isSelected[\s\S]*?\? arr\.filter\(item => item !== value\)[\s\S]*?: \[\.\.\.arr, value\][\s\S]*?\}\)\);[\s\S]*?\};/, 
    `const toggleArrayItem = (field: keyof typeof formData, value: string) => {
        setFormData(prev => {
            const arr = prev[field] as string[];
            const isSelected = arr.includes(value);
            const next = {
                ...prev,
                [field]: isSelected
                    ? arr.filter(item => item !== value)
                    : [...arr, value]
            };
            onChange?.({ interests: next });
            return next;
        });
    };`);
fs.writeFileSync('src/app/farm-nation/onboarding/steps/InterestsStep.tsx', interestsContent);

// 5. Update TermsStep.tsx
let termsContent = fs.readFileSync('src/app/farm-nation/onboarding/steps/TermsStep.tsx', 'utf-8');
termsContent = termsContent.replace('initialData?: any;\n}', 'initialData?: any;\n    onChange?: (data: any) => void;\n}');
termsContent = termsContent.replace('export default function TermsStep({ onNext, onBack, initialData }: TermsStepProps) {', 'export default function TermsStep({ onNext, onBack, onChange, initialData }: TermsStepProps) {');
termsContent = termsContent.replace('setAccepted(e.target.checked);', 'setAccepted(e.target.checked);\n        onChange?.({ terms: { accepted: e.target.checked } });');
fs.writeFileSync('src/app/farm-nation/onboarding/steps/TermsStep.tsx', termsContent);
