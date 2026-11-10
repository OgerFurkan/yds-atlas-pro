import { cn } from "@/shared/lib/utils";

export function AtlasLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className={cn("size-10", className)}>
      <rect width="48" height="48" rx="13" fill="#123b59" />
      <path
        d="M7 12c7-3 12-1 17 3 5-4 10-6 17-3v25c-7-3-12-1-17 2-5-3-10-5-17-2V12Z"
        stroke="white"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="m24 13 3.6 9.4L37 26l-9.4 3.6L24 39l-3.6-9.4L11 26l9.4-3.6L24 13Z" fill="#f27637" />
      <circle cx="24" cy="26" r="3" fill="#123b59" />
    </svg>
  );
}
