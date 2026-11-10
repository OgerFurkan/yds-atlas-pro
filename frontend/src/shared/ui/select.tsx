import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import type * as React from "react";
import { cn } from "@/shared/lib/utils";

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "inline-flex h-9 min-w-0 items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 text-left text-xs font-medium text-slate-700 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-800/20 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown aria-hidden="true" size={14} />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className={cn(
          "z-[100] max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-slate-200 bg-white p-1 text-slate-800 shadow-xl",
          className,
        )}
        position={position}
        sideOffset={5}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-5 items-center justify-center text-slate-500">
          <ChevronUp size={14} />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="p-0.5">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-5 items-center justify-center text-slate-500">
          <ChevronDown size={14} />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex min-h-9 cursor-pointer select-none items-center rounded-md py-1 pl-3 pr-9 text-xs text-slate-700 outline-none focus:bg-slate-100 data-[state=checked]:font-semibold data-[state=checked]:text-sky-950 data-[highlighted]:bg-slate-100",
        className,
      )}
      {...props}
    >
      <span className="absolute right-3 inline-flex items-center text-orange-700">
        <SelectPrimitive.ItemIndicator>
          <Check size={13} />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue };
