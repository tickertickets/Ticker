import { useRoute, useLocation } from "wouter";
import { useGetTicket } from "@workspace/api-client-react";
import { TicketCard } from "@/components/TicketCard";
import { ChainCard } from "@/components/ChainsSection";
import type { ChainItem } from "@/components/ChainsSection";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ChevronLeft } from "lucide-react";
import { navBack } from "@/lib/nav-back";
import { useLang } from "@/lib/i18n";

export default function FeedPost() {
  const [matchTicket, ticketParams] = useRoute("/post/ticket/:id");
  const [matchChain, chainParams]   = useRoute("/post/chain/:id");
  const [, navigate] = useLocation();
  const { lang } = useLang();

  const ticketId = matchTicket ? (ticketParams?.id ?? "") : "";
  const chainId  = matchChain  ? (chainParams?.id  ?? "") : "";
  const title    = lang === "th" ? "โพสต์" : "Post";

  const { data: ticket, isLoading: ticketLoading } = useGetTicket(ticketId, {
    query: { enabled: !!ticketId, staleTime: 0, refetchOnWindowFocus: true } as any,
  });

  const { data: chainRaw, isLoading: chainLoading } = useQuery<any>({
    queryKey: ["/api/chains", chainId],
    queryFn: async () => {
      const res = await fetch(`/api/chains/${chainId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: !!chainId,
    staleTime: 0,
  });

  const isLoading = ticketId ? ticketLoading : chainLoading;

  const chain: ChainItem | null = chainRaw ? {
    id: chainRaw.id,
    title: chainRaw.title,
    description: chainRaw.description ?? null,
    descriptionAlign: chainRaw.descriptionAlign ?? null,
    movieCount: chainRaw.movieCount ?? 0,
    chainCount: chainRaw.chainCount ?? 0,
    likeCount: chainRaw.likeCount ?? 0,
    commentCount: chainRaw.commentCount ?? 0,
    isLiked: chainRaw.isLiked ?? false,
    isBookmarked: chainRaw.isBookmarked ?? false,
    isPrivate: chainRaw.isPrivate ?? false,
    hideComments: chainRaw.hideComments ?? false,
    hideLikes: chainRaw.hideLikes ?? false,
    hideChainCount: chainRaw.hideChainCount ?? false,
    mode: chainRaw.mode ?? null,
    challengeDurationMs: chainRaw.challengeDurationMs ?? null,
    movies: (chainRaw.movies ?? []).map((m: any) => ({ posterUrl: m.posterUrl ?? null, genre: m.genre ?? null })),
    user: chainRaw.user ?? null,
    createdAt: chainRaw.createdAt,
    updatedAt: chainRaw.updatedAt,
    foundMovieIds: chainRaw.foundMovieIds ?? null,
    foundMovieCount: chainRaw.foundMovieCount ?? null,
  } : null;

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 bg-background/95 backdrop-blur-xl border-b border-border flex-shrink-0"
        style={{ paddingTop: "max(16px, env(safe-area-inset-top, 0px))", paddingBottom: "12px" }}
      >
        <button
          onClick={() => navBack(navigate)}
          className="w-9 h-9 rounded-xl flex items-center justify-center bg-secondary active:opacity-70 transition-opacity flex-shrink-0"
        >
          <ChevronLeft className="w-5 h-5 text-foreground" />
        </button>
        <h1 className="font-display font-bold text-lg text-foreground flex-1 text-center">{title}</h1>
        <div className="w-9 h-9 flex-shrink-0" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : ticketId && ticket ? (
          <TicketCard ticket={ticket} />
        ) : chainId && chain ? (
          <ChainCard chain={chain} />
        ) : (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-6">
            <p className="text-sm font-bold text-foreground">ไม่พบโพสต์นี้</p>
            <p className="text-xs text-muted-foreground">Post not found</p>
          </div>
        )}
      </div>
    </div>
  );
}
