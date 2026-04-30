import fs from 'fs';

let content = fs.readFileSync('src/app/academy/application/page.tsx', 'utf-8');

// 1. Add STEPS modification
content = content.replace(
    '    { id: 4, title: "Review", description: "Confirm details" }\n];',
    '    { id: 4, title: "Review", description: "Confirm details" },\n    { id: 5, title: "Payment", description: "Select Plan" }\n];'
);

// 2. Add localStorage logic to useEffect
// We need to inject the draft restoration logic
content = content.replace(
    '    useEffect(() => {\n        const checkStatus = async () => {',
    `    // Restore draft from localStorage
    const [restored, setRestored] = useState(false);
    useEffect(() => {
        if (!session?.user?.id) return;
        try {
            const draft = localStorage.getItem(\`academy_draft_\${session.user.id}\`);
            if (draft) {
                const parsed = JSON.parse(draft);
                if (parsed.personalInfo) setPersonalInfo(parsed.personalInfo);
                if (parsed.education) setEducation(parsed.education);
                if (parsed.interests) setInterests(parsed.interests);
                // Don't auto-set currentStep to avoid skipping the flow entirely, or maybe do set it?
                // if (parsed.currentStep) setCurrentStep(parsed.currentStep);
            }
        } catch (e) {}
        setRestored(true);
    }, [session?.user?.id]);

    // Save draft whenever form data changes
    useEffect(() => {
        if (!session?.user?.id || !restored) return;
        try {
            localStorage.setItem(\`academy_draft_\${session.user.id}\`, JSON.stringify({
                personalInfo, education, interests, currentStep
            }));
        } catch (e) {}
    }, [personalInfo, education, interests, currentStep, session?.user?.id, restored]);

    useEffect(() => {\n        const checkStatus = async () => {`
);

// 3. Remove the top-level payment gate
content = content.replace(
    /\/\/ Payment gate: show payment screen if not yet paid[\s\S]*?if \(paymentStatus === "unpaid"\) \{[\s\S]*?const PLANS = \[[\s\S]*?\}\n\n    return \(/,
    `    const PLANS = [
        { id: "foundation", name: "Foundation Plan", price: 25000 },
        { id: "advanced", name: "Advanced Plan", price: 50000 },
        { id: "elite", name: "Elite Plan", price: 100000 },
    ] as const;

    return (`
);

// 4. Update the "Next" button in step 4 to go to step 5
// Find the handleNext function
content = content.replace(
    'setCurrentStep((prev) => Math.min(prev + 1, 4));',
    'setCurrentStep((prev) => Math.min(prev + 1, 5));'
);

// 5. Update validation for step 5
content = content.replace(
    '        if (step === 4) {\n            if (!acceptTerms) {\n                newErrors.acceptTerms = "You must accept the terms and conditions to continue";\n            }\n        }\n\n        setErrors(newErrors);',
    '        if (step >= 4) {\n            if (!acceptTerms) {\n                newErrors.acceptTerms = "You must accept the terms and conditions to continue";\n            }\n        }\n\n        setErrors(newErrors);'
);


// 6. Inject Step 5 into the render block
content = content.replace(
    '                    {currentStep === 4 && (\n                        <ReviewStep',
    `                    {currentStep === 4 && (
                        <ReviewStep`
);

// Insert Step 5
const step5Content = `
                    {currentStep === 5 && paymentStatus === "unpaid" && (
                        <div className="max-w-lg mx-auto">
                            <div className="text-center mb-8">
                                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <CreditCard className="w-8 h-8 text-blue-600" />
                                </div>
                                <h2 className="text-2xl font-bold text-slate-900 mb-2">Select Academy Plan</h2>
                                <p className="text-slate-600">
                                    Choose a learning plan that fits your career goals to proceed with your application.
                                </p>
                            </div>

                            <div className="space-y-4 mb-6">
                                {PLANS.map(plan => (
                                    <button
                                        key={plan.id}
                                        onClick={() => setSelectedPlan(plan.id)}
                                        className={\`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all \${
                                            selectedPlan === plan.id ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:border-blue-200"
                                        }\`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={\`w-5 h-5 rounded-full border-2 flex items-center justify-center \${
                                                selectedPlan === plan.id ? "border-blue-600" : "border-slate-300"
                                            }\`}>
                                                {selectedPlan === plan.id && <div className="w-2.5 h-2.5 bg-blue-600 rounded-full" />}
                                            </div>
                                            <span className={\`font-semibold \${selectedPlan === plan.id ? "text-blue-900" : "text-slate-700"}\`}>
                                                {plan.name}
                                            </span>
                                        </div>
                                        <span className="text-xl font-bold text-slate-900">
                                            ₦{plan.price.toLocaleString()}
                                        </span>
                                    </button>
                                ))}
                            </div>

                            <button
                                onClick={handlePayment}
                                disabled={isPaying}
                                className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-blue-300 disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {isPaying ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        <Shield className="w-5 h-5" />
                                        Pay ₦{PLANS.find(p => p.id === selectedPlan)?.price.toLocaleString()} to Continue
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                    
                    {currentStep === 5 && paymentStatus === "paid" && (
                        <div className="max-w-lg mx-auto text-center py-8">
                            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                                <CheckCircle className="w-10 h-10 text-green-600" />
                            </div>
                            <h2 className="text-2xl font-bold text-slate-900 mb-4">Payment Confirmed</h2>
                            <p className="text-slate-600 mb-8">
                                Your payment has been successfully processed. Click the button below to submit your application.
                            </p>
                        </div>
                    )}
`;

content = content.replace(
    '                    {/* Navigation Buttons */}',
    step5Content + '\n                    {/* Navigation Buttons */}'
);

// 7. Change logic for Submit button
content = content.replace(
    '{currentStep < 4 ? (',
    '{currentStep < 5 ? ('
);

content = content.replace(
    'if (!validateStep(4)) return;',
    'if (!validateStep(4)) return;'
);

content = content.replace(
    'router.push("/academy/application/pending");',
    `// Clear draft
                try { localStorage.removeItem(\`academy_draft_\${session?.user?.id}\`); } catch (e) {}
                router.push("/academy/application/pending");`
);

fs.writeFileSync('src/app/academy/application/page.tsx', content);
