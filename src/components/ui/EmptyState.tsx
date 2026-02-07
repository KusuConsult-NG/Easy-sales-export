import { PackageOpen, ArrowRight } from "lucide-react";
import Link from "next/link";

interface EmptyStateProps {
    icon?: React.ElementType;
    title: string;
    description: string;
    actionLabel?: string;
    actionHref?: string;
    onAction?: () => void;
}

export default function EmptyState({
    icon: Icon = PackageOpen,
    title,
    description,
    actionLabel,
    actionHref,
    onAction,
}: EmptyStateProps) {
    return (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center mb-6">
                <Icon className="w-10 h-10 text-slate-400 dark:text-slate-600" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                {title}
            </h3>
            <p className="text-slate-600 dark:text-slate-400 max-w-md mb-6">
                {description}
            </p>
            {(actionLabel && (actionHref || onAction)) && (
                <>
                    {actionHref ? (
                        <Link
                            href={actionHref}
                            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition-all"
                        >
                            {actionLabel}
                            <ArrowRight className="w-4 h-4" />
                        </Link>
                    ) : (
                        <button
                            onClick={onAction}
                            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition-all"
                        >
                            {actionLabel}
                            <ArrowRight className="w-4 h-4" />
                        </button>
                    )}
                </>
            )}
        </div>
    );
}
