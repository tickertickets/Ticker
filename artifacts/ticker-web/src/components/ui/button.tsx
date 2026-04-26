import * as React from "react"
import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "link" | "glass"
  size?: "default" | "sm" | "lg" | "icon"
  isLoading?: boolean
}

export function buttonVariants(options?: { variant?: ButtonProps["variant"]; size?: ButtonProps["size"] }): string {
  const { variant = "default", size = "default" } = options ?? {}
  return cn(
    "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
    {
      "bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-[0_0_20px_rgba(255,215,0,0.3)]": variant === "default",
      "border border-white/10 bg-transparent hover:bg-white/5 hover:border-white/20": variant === "outline",
      "hover:bg-white/5 hover:text-white": variant === "ghost",
      "underline-offset-4 hover:underline text-primary": variant === "link",
      "glass-panel hover:bg-white/10 text-white": variant === "glass",
      "h-10 px-4 py-2": size === "default",
      "h-9 rounded-lg px-3": size === "sm",
      "h-12 rounded-xl px-8 text-base": size === "lg",
      "h-10 w-10": size === "icon",
    }
  )
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", isLoading, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={isLoading || disabled}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
          {
            "bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-[0_0_20px_rgba(255,215,0,0.3)]": variant === "default",
            "border border-white/10 bg-transparent hover:bg-white/5 hover:border-white/20": variant === "outline",
            "hover:bg-white/5 hover:text-white": variant === "ghost",
            "underline-offset-4 hover:underline text-primary": variant === "link",
            "glass-panel hover:bg-white/10 text-white": variant === "glass",
            "h-10 px-4 py-2": size === "default",
            "h-9 rounded-lg px-3": size === "sm",
            "h-12 rounded-xl px-8 text-base": size === "lg",
            "h-10 w-10": size === "icon",
          },
          className
        )}
        {...props}
      >
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {children}
      </button>
    )
  }
)
Button.displayName = "Button"

export { Button }
