import type { ReactNode } from "react";

export interface Notify {
  success(message: ReactNode): void;
  error(message: ReactNode): void;
  info(message: ReactNode): void;
}
