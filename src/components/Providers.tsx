"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * Empty client-provider shell. Spec 1 has no client-side fetch (auth + Members
 * are server actions / RSC), but every later spec drives MMA `202 → poll` through
 * TanStack Query, so the provider is mounted once in the root layout.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
