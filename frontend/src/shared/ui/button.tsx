import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/shared/lib/utils";

const buttonVariants = cva(
  "group inline-flex cursor-pointer shrink-0 items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[color,background-color,transform,box-shadow] duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2876a6]/30 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:shrink-0 [&_svg]:transition-transform hover:[&_svg]:scale-110 motion-reduce:transition-none",
  {
    variants: {
      variant: {
        default: "bg-[#f27637] text-white hover:bg-[#d65b24]",
        secondary: "border border-border bg-card text-card-foreground hover:bg-muted",
        outline: "border border-border bg-transparent text-foreground hover:bg-muted",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        destructive: "text-destructive hover:bg-destructive/10",
        link: "text-atlas-blue hover:text-atlas-orange-dark",
      },
      size: {
        default: "min-h-11 rounded-lg px-4 text-sm",
        sm: "min-h-9 rounded-md px-3 text-xs",
        icon: "size-10 rounded-lg",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
