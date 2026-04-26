import { QueryClient } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { persistQueryClient } from "@tanstack/react-query-persist-client";

const PERSIST_PREFIXES = [
  "/api/users/",
  "badge-user",
];

function shouldPersistQuery(queryKey: unknown): boolean {
  const key = typeof queryKey === "string" ? queryKey : String(queryKey ?? "");
  return PERSIST_PREFIXES.some(prefix => key.startsWith(prefix));
}

function isClientError(err: unknown): boolean {
  const status =
    (err as { response?: { status?: number } })?.response?.status ??
    (err as { status?: number })?.status;
  return status === 401 || status === 403 || status === 404;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (failureCount, err) => {
        if (isClientError(err)) return false;
        return failureCount < 3;
      },
      retryDelay: (attemptIndex) => Math.min(2000 + attemptIndex * 3000, 10_000),
      gcTime: 1000 * 60 * 60 * 24,
      staleTime: 5 * 60 * 1000,
    },
  },
});

if (typeof window !== "undefined") {
  const persister = createSyncStoragePersister({
    storage: window.localStorage,
    key: "TICKER_RQ_v1",
    throttleTime: 1000,
    serialize: (data) => {
      const filtered = {
        ...data,
        clientState: {
          ...data.clientState,
          queries: data.clientState.queries.filter((q: any) => {
            const firstKey = q.queryKey?.[0];
            return typeof firstKey === "string" && shouldPersistQuery(firstKey);
          }),
        },
      };
      return JSON.stringify(filtered);
    },
  });

  persistQueryClient({
    queryClient,
    persister,
    maxAge: 1000 * 60 * 60 * 24,
  });
}

export function getDraftKey(userId: string | null | undefined): string {
  return userId ? `ticker_drafts_${userId}` : "ticker_drafts_guest";
}

export function getChainDraftKey(userId: string | null | undefined): string {
  return userId ? `ticker_chain_drafts_${userId}` : "ticker_chain_drafts_guest";
}

export function clearAccountState() {
  queryClient.clear();
}
