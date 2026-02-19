export interface OnboardingStep {
    id: string;
    title: string;
    description: string;
    completed: boolean;
    required: boolean;
}

export interface ServiceRegistration {
    id: string;
    userId: string;
    serviceType: 'export' | 'farm_nation' | 'academy' | 'cooperative';
    status: 'pending' | 'approved' | 'rejected' | 'active';
    currentStep: string;
    completedSteps: string[];
    data: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}
