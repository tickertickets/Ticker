import * as React from "react"
import { cn } from "@/lib/utils"

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string | null;
  fallback?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Avatar({ src, fallback, size = 'md', className, ...props }: AvatarProps) {
  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-16 h-16 text-lg',
    xl: 'w-24 h-24 text-2xl',
  };

  const roundedClasses = {
    sm: 'rounded-lg',
    md: 'rounded-xl',
    lg: 'rounded-2xl',
    xl: 'rounded-2xl',
  };

  const [failed, setFailed] = React.useState(false);

  if (!src || failed) {
    return (
      <div
        className={cn(
          "relative flex shrink-0 overflow-hidden bg-black border border-white/10 items-center justify-center",
          sizeClasses[size],
          roundedClasses[size],
          className
        )}
        {...props}
      >
        <span className="font-bold text-white select-none">
          {fallback?.[0]?.toUpperCase() ?? "T"}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex shrink-0 overflow-hidden bg-black border border-white/10",
        sizeClasses[size],
        roundedClasses[size],
        className
      )}
      {...props}
    >
      <img
        src={src}
        alt="Avatar"
        className="aspect-square h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  )
}
