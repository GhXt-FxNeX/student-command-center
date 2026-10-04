import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "destructive-outline";
export type ButtonSize = "sm" | "md";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent-fill text-white hover:bg-accent-fill-hover active:bg-accent-fill-active",
  secondary: "border border-border text-text hover:bg-bg",
  ghost: "text-accent-text hover:underline disabled:no-underline",
  destructive: "bg-red-600 text-white hover:bg-red-700",
  "destructive-outline": "border border-red-500/40 text-red-700 dark:text-red-400 hover:bg-red-500/10",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
};

/**
 * Every filled/bordered button in the app shares this: rounded-md,
 * transition-colors, a small tactile press (active:scale), and a
 * consistent disabled treatment — the "smooth toggle/button press
 * feedback" micro-interaction the modernization brief asks for, applied
 * once here instead of per call site.
 */
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "sm", className = "") {
  if (variant === "ghost") {
    return `text-xs transition-colors disabled:opacity-40 disabled:pointer-events-none ${VARIANT_CLASSES.ghost} ${className}`;
  }
  return `rounded-md font-medium transition-all duration-150 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none disabled:active:scale-100 ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${className}`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = "secondary", size = "sm", className = "", type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}
