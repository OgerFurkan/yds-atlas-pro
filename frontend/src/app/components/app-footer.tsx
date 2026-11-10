export function AppFooter() {
  return (
    <footer className="flex min-h-12 items-center justify-between border-t border-atlas-line bg-white px-4 text-[10px] text-slate-400 md:px-8 xl:px-14">
      <span>© 2026 YDS Atlas</span>
      <span className="hidden sm:inline">Her kelime bir keşif.</span>
      <span className="inline-flex items-center gap-1.5">
        <i className="size-1.5 rounded-full bg-emerald-500" /> Sistem hazır
      </span>
    </footer>
  );
}
