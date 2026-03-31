import * as React from "react"
import { cn } from "@/lib/utils"

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-lg border border-[color:var(--xm-border)] bg-[color:var(--xm-surface)] px-3 py-2 text-sm text-[color:var(--xm-text)] ring-offset-background placeholder:text-[color:var(--xm-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--xm-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--xm-bg)] disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
