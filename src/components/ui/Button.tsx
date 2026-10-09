import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary";

const base =
  "inline-flex min-h-12 items-center justify-center rounded-full px-6 text-base font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60";

const variants: Record<Variant, string> = {
  // White on the darker orange keeps the 4.5:1 contrast the brand orange misses.
  primary: "bg-brand-dark text-white hover:bg-brand-darker",
  secondary: "bg-peach text-brand-darker hover:bg-[#ffdcbd]",
};

/** Same look for <Link> and <a>: className={buttonClass("primary")}. */
export function buttonClass(variant: Variant = "primary", extra = ""): string {
  return `${base} ${variants[variant]} ${extra}`;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  return <button className={buttonClass(variant, className)} {...props} />;
}
