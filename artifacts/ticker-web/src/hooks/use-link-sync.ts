import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { SocialLink } from "@/lib/socialLinks";

export function useLinkSync() {
  const qc = useQueryClient();

  const syncTicketLinks = useCallback(
    (ticketId: string, newLinks: SocialLink[]) => {
      // 1. Patch single-ticket detail cache
      qc.setQueryData([`/api/tickets/${ticketId}`], (old: any) =>
        old ? { ...old, captionLinks: newLinks } : old,
      );

      // 2. Patch every ticket-list cache variant (prefix match)
      qc.setQueriesData({ queryKey: ["/api/tickets"] }, (old: any) => {
        if (!old?.tickets) return old;
        return {
          ...old,
          tickets: old.tickets.map((t: any) =>
            t.id === ticketId ? { ...t, captionLinks: newLinks } : t,
          ),
        };
      });

      // 3. Patch every mixed-feed variant ("discover", "following", bare key)
      qc.setQueriesData({ queryKey: ["mixed-feed"] }, (old: any) => {
        if (!old?.items) return old;
        return {
          ...old,
          items: old.items.map((item: any) =>
            item.type === "ticket" && item.ticket?.id === ticketId
              ? { ...item, ticket: { ...item.ticket, captionLinks: newLinks } }
              : item,
          ),
        };
      });

      // 4. Background refetch for eventual consistency
      qc.invalidateQueries({ queryKey: ["/api/tickets"] });
    },
    [qc],
  );

  const syncChainLinks = useCallback(
    (chainId: string, newLinks: SocialLink[]) => {
      // 1. Patch single-chain detail cache
      qc.setQueryData(["/api/chains", chainId], (old: any) =>
        old ? { ...old, descriptionLinks: newLinks } : old,
      );

      // 2. Patch chains-feed cache
      qc.setQueryData(["chains-feed"], (old: any) => {
        if (!old?.chains) return old;
        return {
          ...old,
          chains: old.chains.map((c: any) =>
            c.id === chainId ? { ...c, descriptionLinks: newLinks } : c,
          ),
        };
      });

      // 3. Patch every mixed-feed variant
      qc.setQueriesData({ queryKey: ["mixed-feed"] }, (old: any) => {
        if (!old?.items) return old;
        return {
          ...old,
          items: old.items.map((item: any) =>
            item.type === "chain" && item.chain?.id === chainId
              ? { ...item, chain: { ...item.chain, descriptionLinks: newLinks } }
              : item,
          ),
        };
      });

      // 4. Background refetch for eventual consistency
      qc.invalidateQueries({ queryKey: ["chains-feed"] });
      qc.invalidateQueries({ queryKey: ["mixed-feed"] });
    },
    [qc],
  );

  return { syncTicketLinks, syncChainLinks };
}
