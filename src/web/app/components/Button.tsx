import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'quiet' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-sun text-ink shadow-chip hover:bg-sun-deep',
  quiet: 'bg-panel-raised text-cream shadow-chip hover:bg-panel-edge',
  ghost: 'text-muted hover:text-cream hover:bg-panel-raised',
};

export function Button({
  variant = 'quiet',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-10 items-center whitespace-nowrap justify-center gap-2 rounded-lg px-3 text-base font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sun disabled:opacity-50 pointer-fine:text-sm ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
