import { cn } from "@/shared/lib/utils";

export function AtlasLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className={cn("size-10", className)}>
      <rect x="1" y="1" width="46" height="46" rx="12" fill="#123b59" />
      <path
        d="M10.5 14.2c5.4-1.8 9.2-.8 13.5 2.4 4.3-3.2 8.1-4.2 13.5-2.4v20.4c-5.4-1.8-9.2-.8-13.5 2.4-4.3-3.2-8.1-4.2-13.5-2.4V14.2Z"
        stroke="#eef6fa"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M24 16.6v20"
        stroke="#eef6fa"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.8"
      />
      <path d="m24 20.1 1.8 4.3 4.3 1.8-4.3 1.8-1.8 4.3-1.8-4.3-4.3-1.8 1.8-4.3Z" fill="#ff955d" />
      <circle cx="24" cy="26.2" r="1.1" fill="#123b59" />
    </svg>
  );
}
