import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

//when we doing => npx shadcn-ui@latest init

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
