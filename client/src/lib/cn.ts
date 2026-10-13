import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/** Theme shadows are custom tokens; registering them lets later utilities win cleanly. */
const twMerge = extendTailwindMerge({ extend: { classGroups: { shadow: [{ shadow: ['panel', 'float'] }] } } });

/** Joins class names; later Tailwind utilities override conflicting earlier ones (e.g. w-full → w-auto). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
