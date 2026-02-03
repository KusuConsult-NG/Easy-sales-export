"use client";

import { useState, ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface AccordionItemProps {
    title: string;
    children: ReactNode;
}

export function AccordionItem({ title, children }: AccordionItemProps) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="border-b border-slate-200 dark:border-slate-700">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full py-4 px-6 flex items-center justify-between text-left hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
            >
                <span className="font-semibold text-slate-900 dark:text-white">
                    {title}
                </span>
                <ChevronDown
                    className={`w-5 h-5 text-slate-500 transition-transform ${isOpen ? "rotate-180" : ""
                        }`}
                />
            </button>
            <div
                className={`overflow-hidden transition-all duration-300 ${isOpen ? "max-h-96" : "max-h-0"
                    }`}
            >
                <div className="px-6 pb-4 text-slate-600 dark:text-slate-400">
                    {children}
                </div>
            </div>
        </div>
    );
}

interface AccordionProps {
    children: ReactNode;
}

export default function Accordion({ children }: AccordionProps) {
    return (
        <div className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden elevation-2">
            {children}
        </div>
    );
}
