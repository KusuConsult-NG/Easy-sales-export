"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";

/**
 * A type-or-choose field that works on a phone.
 *
 *   #823 THE WARD LIST SHOWED NOTHING ON MOBILE, AND NOTHING AFTER GOING BACK.
 *
 *   The owner: "The issue with ward is that it is not populating when users are
 *   filling the form and go back to make corrections in what was filled
 *   previously. also on mobile the dropdown doesnt show. The implementation has
 *   to be mobile responsive."
 *
 *   Two symptoms, ONE CAUSE: these fields were `<input list="…">` with a
 *   `<datalist>`.
 *
 * ── WHY IT SHOWED NOTHING ON A PHONE ────────────────────────────────────────
 *
 *   `<datalist>` is the worst-supported form control in the platform. iOS
 *   Safari renders NO suggestion UI for it at all, and Android browsers vary
 *   between a cramped native strip and nothing. It is not a styling problem —
 *   there is no element to style, because the browser never draws one. So on
 *   the device most WAVE applicants actually use, the ward field was a plain
 *   text box and the 8,778-ward register might as well not have existed.
 *
 * ── AND WHY IT WENT BLANK ON THE WAY BACK ───────────────────────────────────
 *
 *   A datalist FILTERS ITS OPTIONS BY THE INPUT'S CURRENT VALUE. An applicant
 *   returning to correct an answer arrives with her previous ward already in
 *   the box, so the only option that still prefix-matches is the one already
 *   chosen — and browsers show no popup for that. To see the list again she had
 *   to know to clear the field first. Nothing on the screen said so, so the
 *   field looked broken precisely at the moment she was trying to fix something.
 *
 * ── WHAT THIS DOES INSTEAD ──────────────────────────────────────────────────
 *
 *   Real DOM. A button that opens a real list, rendered by this application,
 *   which every browser can draw and this codebase can style.
 *
 *   OPENING SHOWS EVERYTHING. Focusing or tapping the control lists ALL the
 *   options regardless of what is already typed — that is the "go back" case,
 *   made the default rather than a trick. Typing then filters.
 *
 *   AND IT STILL TAKES AN ANSWER THAT IS NOT ON THE LIST. #789 is this
 *   codebase's record of what a required dropdown costs when the register is
 *   incomplete: 8,778 wards is what INEC publishes, not a promise that nobody's
 *   ward is missing. The typed value is kept, so a woman whose ward is not
 *   listed can still finish the form.
 */
export interface ComboBoxProps {
    /** The current value. Free text is allowed and preserved. */
    value: string;
    onChange: (value: string) => void;
    /** The suggestions. May be empty — the field degrades to a text box. */
    options: readonly string[];
    placeholder?: string;
    disabled?: boolean;
    id?: string;
    /** Rendered under the control when the caller has something to say. */
    error?: string;
    /** Announced to screen readers alongside the label the caller renders. */
    ariaLabel?: string;
    className?: string;
}

export default function ComboBox({
    value,
    onChange,
    options,
    placeholder,
    disabled = false,
    id,
    error,
    ariaLabel,
    className = "",
}: ComboBoxProps) {
    const reactId = useId();
    const inputId = id ?? `combo-${reactId}`;
    const listId = `${inputId}-list`;

    const [open, setOpen] = useState(false);
    /**
     * What the user has typed SINCE opening, or null when they have not typed.
     *
     * Kept apart from `value` on purpose: it is what makes "open shows
     * everything" work. While it is null the list is unfiltered, however full
     * the field already is — which is the returning-applicant case this
     * component exists for.
     */
    const [typed, setTyped] = useState<string | null>(null);
    const [active, setActive] = useState(0);

    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    const filtered = useMemo(() => {
        if (typed === null || !typed.trim()) return options;
        const q = typed.trim().toLowerCase();
        //   Substring, not prefix: somebody typing "malali" should find
        //   "Badarawa/Malali", which a prefix match never would.
        return options.filter((o) => o.toLowerCase().includes(q));
    }, [options, typed]);

    //   Close on a click or tap anywhere else. `pointerdown` rather than
    //   `click` so it fires on touch before the control can steal focus back.
    useEffect(() => {
        if (!open) return;
        function onPointerDown(e: PointerEvent) {
            if (!rootRef.current?.contains(e.target as Node)) {
                setOpen(false);
                setTyped(null);
            }
        }
        document.addEventListener("pointerdown", onPointerDown);
        return () => document.removeEventListener("pointerdown", onPointerDown);
    }, [open]);

    //   Keep the highlighted row in view when arrowing through a long list —
    //   8,778 wards means a ward list can be hundreds long for one LGA.
    useEffect(() => {
        if (!open || !listRef.current) return;
        const el = listRef.current.children[active] as HTMLElement | undefined;
        //   Guarded because scrollIntoView is not universal — jsdom has no
        //   implementation, and neither do some embedded webviews. Keeping the
        //   highlighted row in view is a courtesy; throwing on the way would
        //   take the whole field down for it.
        if (typeof el?.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
    }, [active, open]);

    function openList() {
        if (disabled) return;
        setOpen(true);
        setTyped(null);
        setActive(0);
    }

    function choose(option: string) {
        onChange(option);
        setTyped(null);
        setOpen(false);
        inputRef.current?.focus();
    }

    function onKeyDown(e: React.KeyboardEvent) {
        if (disabled) return;

        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) { openList(); return; }
            setActive((i) => {
                if (filtered.length === 0) return 0;
                const next = e.key === "ArrowDown" ? i + 1 : i - 1;
                return (next + filtered.length) % filtered.length;
            });
            return;
        }

        if (e.key === "Enter" && open) {
            //   Only steals Enter when there is something highlighted to take.
            //   Otherwise the typed value stands and the form may submit.
            if (filtered[active]) { e.preventDefault(); choose(filtered[active]); }
            return;
        }

        if (e.key === "Escape" && open) {
            e.preventDefault();
            setOpen(false);
            setTyped(null);
        }
    }

    return (
        <div ref={rootRef} className={`relative ${className}`}>
            <div className="relative">
                <input
                    id={inputId}
                    ref={inputRef}
                    type="text"
                    role="combobox"
                    aria-expanded={open}
                    aria-controls={listId}
                    aria-autocomplete="list"
                    aria-label={ariaLabel}
                    aria-invalid={Boolean(error) || undefined}
                    autoComplete="off"
                    disabled={disabled}
                    placeholder={placeholder}
                    value={typed ?? value}
                    onChange={(e) => {
                        setTyped(e.target.value);
                        //   The typed text IS the answer until a row is chosen,
                        //   so a ward that is not on the list survives.
                        onChange(e.target.value);
                        setOpen(true);
                        setActive(0);
                    }}
                    onFocus={openList}
                    //   Tapping an already-focused field must still reopen it.
                    onClick={openList}
                    onKeyDown={onKeyDown}
                    className="w-full px-4 py-3 pr-11 border border-slate-300 rounded-xl text-base focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 disabled:bg-slate-100 disabled:text-slate-400"
                />
                <button
                    type="button"
                    tabIndex={-1}
                    aria-hidden="true"
                    disabled={disabled}
                    onClick={() => (open ? setOpen(false) : openList())}
                    /*
                     *   A 44px target, which is the smallest a thumb reliably
                     *   hits. The control this replaces had no affordance at
                     *   all on a phone — nothing to tap, and nothing to suggest
                     *   there was a list behind it.
                     */
                    className="absolute inset-y-0 right-0 flex h-full w-11 items-center justify-center text-slate-400 disabled:text-slate-300"
                >
                    <ChevronDown className={`w-5 h-5 transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
            </div>

            {open && !disabled && (
                <ul
                    id={listId}
                    ref={listRef}
                    role="listbox"
                    /*
                     *   MOBILE-RESPONSIVE BY CONSTRUCTION: full width of the
                     *   field, capped at a portion of the viewport rather than a
                     *   fixed pixel height, and scrollable with momentum on iOS.
                     *   A fixed max-height is what pushes a long list off the
                     *   bottom of a small screen.
                     */
                    className="absolute z-50 mt-1 w-full max-h-[min(16rem,50vh)] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white shadow-lg"
                >
                    {filtered.length === 0 ? (
                        <li className="px-4 py-3 text-sm text-slate-500">
                            {options.length === 0
                                ? "No list available — type your answer."
                                : "No match — your typed answer will be kept."}
                        </li>
                    ) : (
                        filtered.map((option, i) => (
                            <li
                                key={option}
                                role="option"
                                aria-selected={option === value}
                                //   pointerdown, not click: on touch, `click`
                                //   arrives after the input's blur and the list
                                //   would already be gone.
                                onPointerDown={(e) => { e.preventDefault(); choose(option); }}
                                onMouseEnter={() => setActive(i)}
                                className={`flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-base ${
                                    i === active ? "bg-emerald-50 text-emerald-900" : "text-slate-700"
                                }`}
                            >
                                <span className="truncate">{option}</span>
                                {option === value && <Check className="w-4 h-4 shrink-0 text-emerald-600" />}
                            </li>
                        ))
                    )}
                </ul>
            )}

            {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
        </div>
    );
}
