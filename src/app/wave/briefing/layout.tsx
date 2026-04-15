import { ReactNode } from 'react';

// Force dynamic rendering to prevent prerendering issues with Firebase Admin SDK missing in the build container
export const dynamic = 'force-dynamic';

export default function WaveBriefingLayout({ children }: { children: ReactNode }) {
    return <>{children}</>;
}
