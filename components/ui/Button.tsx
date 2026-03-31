import * as React from "react"
import { cn } from "@/lib/utils"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'secondary' | 'destructive';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-semibold ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--xm-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--xm-bg)] disabled:pointer-events-none disabled:opacity-60 active:translate-y-[1px]",
          {
            "bg-[color:var(--xm-primary)] text-[color:var(--xm-primary-contrast)] hover:brightness-110 shadow-[var(--xm-shadow-sm)]":
              variant === "default",
            "border border-[color:var(--xm-border)] bg-transparent text-[color:var(--xm-text)] hover:bg-[color:var(--xm-hover)]":
              variant === "outline",
            "text-[color:var(--xm-text)] hover:bg-[color:var(--xm-hover)]": variant === "ghost",
            "bg-[color:var(--xm-accent)] text-[color:var(--xm-accent-contrast)] hover:brightness-110 shadow-[var(--xm-shadow-sm)]":
              variant === "secondary",
            "bg-[color:var(--xm-danger)] text-white hover:brightness-110 shadow-[var(--xm-shadow-sm)]":
              variant === "destructive",
            "h-10 px-4": size === "default",
            "h-9 px-3": size === "sm",
            "h-11 px-8": size === "lg",
            "h-10 w-10": size === "icon",
          },
          className
        )}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }
