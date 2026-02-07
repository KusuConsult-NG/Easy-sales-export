import { Loader2 } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva(
    "relative inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all disabled:opacity-70 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2",
    {
        variants: {
            variant: {
                primary: "bg-linear-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white focus:ring-blue-500",
                secondary: "bg-slate-200 hover:bg-slate-300 text-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-white focus:ring-slate-500",
                danger: "bg-linear-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white focus:ring-red-500",
                success: "bg-linear-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white focus:ring-green-500",
                outline: "border-2 border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-white focus:ring-slate-500",
            },
            size: {
                sm: "px-4 py-2 text-sm",
                md: "px-6 py-3 text-base",
                lg: "px-8 py-4 text-lg",
            },
        },
        defaultVariants: {
            variant: "primary",
            size: "md",
        },
    }
);

interface LoadingButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
    loading?: boolean;
    loadingText?: string;
    icon?: React.ReactNode;
}

export default function LoadingButton({
    loading = false,
    children,
    loadingText,
    icon,
    disabled,
    variant,
    size,
    className = "",
    ...props
}: LoadingButtonProps) {
    return (
        <button
            disabled={disabled || loading}
            className={buttonVariants({ variant, size, className })}
            aria-busy={loading}
            aria-disabled={disabled || loading}
            {...props}
        >
            {loading && (
                <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
            )}
            {!loading && icon && <span aria-hidden="true">{icon}</span>}
            <span>{loading && loadingText ? loadingText : children}</span>
        </button>
    );
}
