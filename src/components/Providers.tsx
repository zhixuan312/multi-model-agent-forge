"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { TooltipProvider } from "@/components/ui";

/**
 * Client-provider shell. TanStack Query drives every MMA `202 → poll` flow, and
 * the Radix `TooltipProvider` is mounted once here so individual `Tooltip`s need
 * no provider of their own. Both wrap the whole app via the root layout.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}
