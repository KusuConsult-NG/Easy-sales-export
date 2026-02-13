import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
    size?: 'sm' | 'md' | 'lg' | 'xl';
    text?: string;
    fullScreen?: boolean;
}

const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16',
};

export function LoadingSpinner({ size = 'md', text, fullScreen = false }: LoadingSpinnerProps) {
    const content = (
        <div className="flex flex-col items-center justify-center gap-3">
            <Loader2 className={`${sizeClasses[size]} text-primary animate-spin`} />
            {text && (
                <p className="text-slate-600 dark:text-slate-400 text-sm font-medium">
                    {text}
                </p>
            )}
        </div>
    );

    if (fullScreen) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                {content}
            </div>
        );
    }

    return content;
}

export function SkeletonCard() {
    return (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg animate-pulse">
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-4" />
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/2 mb-2" />
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-2/3" />
        </div>
    );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
    return (
        <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-lg">
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 animate-pulse">
                <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded w-1/4" />
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-700">
                {Array.from({ length: rows }).map((_, i) => (
                    <div key={i} className="p-4 animate-pulse">
                        <div className="flex gap-4">
                            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded flex-1" />
                            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded flex-1" />
                            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded flex-1" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
