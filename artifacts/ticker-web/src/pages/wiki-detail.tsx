import { useRoute, useLocation, useSearch, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft, Bookmark, Heart, MessagesSquare,
  Loader2, ExternalLink, Globe, BookOpen, Send, Trash2, CornerDownRight,
} from "lucide-react";
import { navBack } from "@/lib/nav-back";
import { useAuth } from "@/hooks/use-auth";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useSocketWikiUpdates } from "@/hooks/use-socket";
import { Link as WouterLink } from "wouter";
import { useLang } from "@/lib/i18n";

type WikiItem = {
  id: string;
  wikiPageId: string;
  title: string;
  excerpt: string | null;
  thumbnailUrl: string | null;
  url: string;
  lang: string;
  category: string;
};

type WikiDetailResponse = {
  item: WikiItem;
  likeCount: number;
  commentCount: number;
  isLiked: boolean;
  isBookmarked: boolean;
};

type WikiComment = {
  id: string;
  content: string;
  createdAt: string;
  userId: string;
  replyToId?: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

type PopularWikiItem = {
  wikiPageId: string;
  title: string;
  excerpt: string | null;
  thumbnailUrl: string | null;
  category: string;
};

const WIKI_CAT_LABEL: Record<string, { th: string; en: string }> = {
  character: { th: "ตัวละคร",   en: "Character" },
  item:      { th: "ไอเทม",     en: "Item"       },
  location:  { th: "สถานที่",   en: "Location"   },
  movie:     { th: "ภาพยนตร์",  en: "Movie"      },
  series:    { th: "ซีรีส์",    en: "Series"     },
  other:     { th: "อื่นๆ",     en: "Other"      },
};
function wikiCatLabel(cat: string, lang: string) {
  const entry = WIKI_CAT_LABEL[cat];
  if (!entry) return cat;
  return lang === "th" ? entry.th : entry.en;
}

function HeroImage({ thumbnail, fallback, title }: { thumbnail: string | null; fallback?: string | null; title: string }) {
  const [src, setSrc] = useState<string | null>(thumbnail);
  const [imgFailed, setImgFailed] = useState(false);

  // When the thumbnail prop changes, update src — but ONLY if we don't already have
  // a successfully loaded image. Replacing a working image causes the "flash then
  // disappear" bug (new URL triggers an img reload during which nothing is shown,
  // and if the new URL fails the image is gone entirely).
  const prevThumbnail = useRef<string | null>(thumbnail);
  useEffect(() => {
    if (thumbnail !== prevThumbnail.current) {
      prevThumbnail.current = thumbnail;
      if (thumbnail && (!src || imgFailed)) {
        // No working image yet — load the new URL
        setSrc(thumbnail);
        setImgFailed(false);
      }
      // If we already have a working image (src && !imgFailed), keep it.
      // The visible image stays stable; the new URL is silently ignored.
    }
  }, [thumbnail, src, imgFailed]);

  const showImage = !!src && !imgFailed;
  return (
    <div className="relative w-full overflow-hidden bg-secondary" style={{ height: 280 }}>
      {showImage ? (
        <img
          src={src!}
          alt={title}
          className="absolute inset-0 w-full h-full object-cover object-top"
          onError={() => {
            if (fallback && src !== fallback) {
              setSrc(fallback);
            } else {
              setImgFailed(true);
            }
          }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <BookOpen className="w-12 h-12 text-muted-foreground opacity-20" />
        </div>
      )}
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-background via-background/60 to-transparent pointer-events-none" />
    </div>
  );
}


function RelatedWikiItems({ category, currentPageId, lang }: { category: string; currentPageId: string; lang: string }) {
  const { data } = useQuery<{ items: PopularWikiItem[]; hasMore: boolean; page: number }>({
    queryKey: ["wiki-popular"],
    queryFn: () => fetch("/api/wiki/popular?page=1", { credentials: "include" }).then(r => r.json()),
    staleTime: 1000 * 60 * 5,
  });

  const related = (data?.items ?? [])
    .filter(item => item.category === category && item.wikiPageId !== currentPageId)
    .slice(0, 5);

  if (related.length === 0) return null;

  const sectionLabel = lang === "th"
    ? (category === "character" ? "ตัวละครที่เกี่ยวข้อง" : category === "item" ? "ไอเทมที่เกี่ยวข้อง" : category === "location" ? "สถานที่ที่เกี่ยวข้อง" : "ที่เกี่ยวข้อง")
    : (category === "character" ? "Related Characters" : category === "item" ? "Related Items" : category === "location" ? "Related Locations" : "Related");

  return (
    <div className="border-t border-border mt-6">
      <div className="px-5 pt-4 pb-2">
        <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-3">{sectionLabel}</h2>
        <div className="flex flex-col gap-2">
          {related.map(item => {
            const href = `/wiki/${encodeURIComponent(item.wikiPageId)}?lang=en${item.thumbnailUrl ? `&thumb=${encodeURIComponent(item.thumbnailUrl)}` : ""}`;
            return (
              <WouterLink key={item.wikiPageId} href={href}>
                <div className="flex items-center gap-3 bg-secondary rounded-2xl p-3 border border-border active:opacity-70 transition-opacity">
                  <div className="w-12 h-12 rounded-xl overflow-hidden bg-background flex-shrink-0 border border-border">
                    {item.thumbnailUrl ? (
                      <img src={item.thumbnailUrl} alt={item.title} className="w-full h-full object-cover"
                        onError={e => { e.currentTarget.style.display = "none"; }} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <BookOpen className="w-4 h-4 text-muted-foreground opacity-40" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-foreground leading-tight line-clamp-1">{item.title}</p>
                    {item.category && item.category !== "other" && (
                      <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full mt-0.5 bg-foreground/8 text-foreground border border-border">
                        {wikiCatLabel(item.category, lang)}
                      </span>
                    )}
                    {item.excerpt && (
                      <p className="text-xs text-muted-foreground line-clamp-1 leading-snug mt-0.5">{item.excerpt}</p>
                    )}
                  </div>
                </div>
              </WouterLink>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function fmtDate(iso: string, lang: string = "th") {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (lang === "en") {
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m`;
    if (hrs < 24) return `${hrs}h`;
    if (days < 7) return `${days}d`;
    return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short" });
  }
  if (mins < 1) return "เมื่อกี้";
  if (mins < 60) return `${mins} นาที`;
  if (hrs < 24) return `${hrs} ชั่วโมง`;
  if (days < 7) return `${days} วัน`;
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

export default function WikiDetail() {
  const [, params] = useRoute("/wiki/:pageId");
  const [, navigate] = useLocation();
  const search = useSearch();
  const pageId = params?.pageId ? decodeURIComponent(params.pageId) : null;
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{ id: string; username: string } | null>(null);
  const { lang } = useLang();

  // Parse URL params early so they can seed state
  const searchParams = new URLSearchParams(search);
  const thumbFallback = searchParams.get("thumb");
  const urlLang = searchParams.get("lang") ?? "en";

  // displayLang: follows the search language on first load; user can switch via toggle
  const [displayLang, setDisplayLang] = useState<string>(urlLang);

  // Toggle always shows EN / TH — search language only sets the initial content
  const toggleLangs = ["en", "th"] as const;

  const isWikidata = pageId?.startsWith("wd:");
  useSocketWikiUpdates(pageId ?? undefined, displayLang);

  const { data, isLoading } = useQuery<WikiDetailResponse>({
    queryKey: ["/api/wiki", pageId, displayLang],
    queryFn: async () => {
      const thumbQ = thumbFallback ? `&thumb=${encodeURIComponent(thumbFallback)}` : "";
      const langParam = isWikidata ? `?lang=${displayLang}${thumbQ}` : "";
      const res = await fetch(`/api/wiki/${encodeURIComponent(pageId!)}${langParam}`, { credentials: "include" });
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: !!pageId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: commentsData, refetch: refetchComments } = useQuery<{ comments: WikiComment[] }>({
    queryKey: ["/api/wiki", pageId, "comments"],
    queryFn: async () => {
      const res = await fetch(`/api/wiki/${encodeURIComponent(pageId!)}/comments`, { credentials: "include" });
      if (!res.ok) return { comments: [] };
      return res.json();
    },
    enabled: !!pageId,
  });
  const allComments = commentsData?.comments ?? [];

  // Build threaded comment structure
  const rootComments = allComments.filter(c => !c.replyToId);
  const repliesMap = new Map<string, WikiComment[]>();
  for (const c of allComments) {
    if (c.replyToId) {
      const arr = repliesMap.get(c.replyToId) ?? [];
      arr.push(c);
      repliesMap.set(c.replyToId, arr);
    }
  }

  const item = data?.item;
  const likeCount = data?.likeCount ?? 0;
  const commentCount = data?.commentCount ?? 0;
  const isLiked = data?.isLiked ?? false;
  const isBookmarked = data?.isBookmarked ?? false;

  // Prefer the thumbnail we navigated with (from search card) to avoid flicker.
  // The API URL might differ in size/format and can trigger a reload that flashes blank.
  // Only use the API URL when we have no navigation-time thumbnail.
  const effectiveThumbnail = thumbFallback || item?.thumbnailUrl || null;

  const likeMutation = useMutation({
    mutationFn: async () => {
      const method = isLiked ? "DELETE" : "POST";
      const res = await fetch(`/api/wiki/${encodeURIComponent(pageId!)}/like`, { method, credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["/api/wiki", pageId, displayLang] });
      const prev = qc.getQueryData<WikiDetailResponse>(["/api/wiki", pageId, displayLang]);
      if (prev) {
        qc.setQueryData<WikiDetailResponse>(["/api/wiki", pageId, displayLang], {
          ...prev,
          isLiked: !prev.isLiked,
          likeCount: prev.isLiked ? prev.likeCount - 1 : prev.likeCount + 1,
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["/api/wiki", pageId, displayLang], ctx.prev);
    },
  });

  const bookmarkMutation = useMutation({
    mutationFn: async () => {
      const method = isBookmarked ? "DELETE" : "POST";
      const res = await fetch(`/api/wiki/${encodeURIComponent(pageId!)}/bookmark`, { method, credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["/api/wiki", pageId, displayLang] });
      const prev = qc.getQueryData<WikiDetailResponse>(["/api/wiki", pageId, displayLang]);
      if (prev) {
        qc.setQueryData<WikiDetailResponse>(["/api/wiki", pageId, displayLang], {
          ...prev, isBookmarked: !prev.isBookmarked,
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["/api/wiki", pageId, displayLang], ctx.prev);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/wiki/bookmarks"] });
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: string) => {
      const res = await fetch(`/api/wiki/${encodeURIComponent(pageId!)}/comments/${commentId}`, {
        method: "DELETE", credentials: "include",
      });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/wiki", pageId, "comments"] });
      qc.invalidateQueries({ queryKey: ["/api/wiki", pageId, displayLang] });
    },
  });

  const submitComment = async () => {
    if (!comment.trim() || submitting || !pageId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/wiki/${encodeURIComponent(pageId)}/comments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: comment.trim(), replyToId: replyingTo?.id ?? null }),
      });
      if (res.ok) {
        setComment("");
        setReplyingTo(null);
        qc.invalidateQueries({ queryKey: ["/api/wiki", pageId, "comments"] });
        qc.invalidateQueries({ queryKey: ["/api/wiki", pageId, displayLang] });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const cat = item?.category ?? "other";
  const catLabel = wikiCatLabel(cat, lang);
  const paragraphs = item?.excerpt
    ? item.excerpt.split(/\n{2,}/).filter(p => p.trim().length > 0)
    : [];

  const CommentRow = ({ c, isReply = false }: { c: WikiComment; isReply?: boolean }) => (
    <div className={cn("flex gap-3", isReply && "ml-8 pl-3 border-l border-border")}>
      <WouterLink href={`/profile/${c.username}`}>
        <div className={cn("rounded-lg overflow-hidden bg-black border border-white/10 flex-shrink-0 flex items-center justify-center", isReply ? "w-7 h-7" : "w-8 h-8")}>
          {c.avatarUrl ? (
            <img src={c.avatarUrl} alt={c.displayName ?? c.username ?? ""} className="w-full h-full object-cover" />
          ) : (
            <span className="text-xs font-bold text-white">{(c.displayName ?? c.username ?? "?")?.[0]?.toUpperCase()}</span>
          )}
        </div>
      </WouterLink>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 mb-1 flex-wrap">
          <WouterLink href={`/profile/${c.username}`}>
            <span className="text-xs font-bold text-foreground">{c.displayName ?? c.username}</span>
          </WouterLink>
          <span className="text-[10px] text-muted-foreground">{fmtDate(c.createdAt, lang)}</span>
          {user?.id === c.userId && (
            <button
              onClick={() => deleteCommentMutation.mutate(c.id)}
              disabled={deleteCommentMutation.isPending}
              className="ml-auto p-1 text-muted-foreground/40 hover:text-destructive transition-colors disabled:opacity-40"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="bg-secondary rounded-2xl rounded-tl-sm px-3.5 py-2.5">
          <p className="text-sm text-foreground/90 leading-relaxed break-words" style={{ overflowWrap: "break-word", wordBreak: "break-word" }}>{c.content}</p>
        </div>
        {!isReply && user && (
          <button
            onClick={() => setReplyingTo({ id: c.id, username: c.username ?? c.displayName ?? "?" })}
            className="text-[10px] text-muted-foreground font-semibold mt-1 ml-1 flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <CornerDownRight className="w-3 h-3" />
            {lang === "th" ? "ตอบกลับ" : "Reply"}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="absolute inset-0 bg-background flex flex-col overflow-hidden">
      {/* ── Overlay nav buttons (absolute over hero image) ── */}
      <button
        onClick={() => navBack(navigate)}
        className="absolute z-20 left-4 w-9 h-9 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center border border-white/20"
        style={{ top: "max(1rem, env(safe-area-inset-top, 0px))" }}
      >
        <ChevronLeft className="w-5 h-5 text-white translate-x-[-1px]" />
      </button>
      <button
        onClick={() => {
          if (!user) { toast({ title: lang === "th" ? "เข้าสู่ระบบเพื่อบุ๊กมาร์ก" : "Sign in to bookmark", duration: 1500 }); return; }
          bookmarkMutation.mutate();
        }}
        disabled={bookmarkMutation.isPending}
        className="absolute z-20 right-4 w-9 h-9 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center border border-white/20"
        style={{ top: "max(1rem, env(safe-area-inset-top, 0px))" }}
      >
        <Bookmark className={cn("w-4.5 h-4.5", isBookmarked ? "fill-white text-white" : "text-white")} />
      </button>

      {/* ── Scrollable body ── */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-y-none">

        {/* ── Hero image ── */}
        <HeroImage thumbnail={effectiveThumbnail} fallback={thumbFallback} title={item?.title ?? ""} />

        {/* ── Content ── */}
        {isLoading && !item ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : !item ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <BookOpen className="w-8 h-8 text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground">{lang === "th" ? "ไม่พบข้อมูล" : "Not found"}</p>
          </div>
        ) : (
          <div className="pb-4">
            {/* Title + meta */}
            <div className="px-5 pt-4 pb-3">
              {cat && cat !== "other" && (
                <span className="inline-block text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full mb-2 bg-foreground/8 text-foreground border border-border">
                  {catLabel}
                </span>
              )}

              <h1 className="font-display font-black text-2xl text-foreground leading-tight mb-2">
                {item.title}
              </h1>

              {/* Source link + EN/TH toggle */}
              <div className="flex items-center gap-3 mb-4">
                {item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] text-muted-foreground active:opacity-60"
                  >
                    <Globe className="w-3 h-3" />
                    <span>Wikipedia</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}

                {isWikidata && (
                  <div className="flex items-center bg-secondary rounded-full p-0.5 border border-border ml-auto">
                    {toggleLangs.map(l => (
                      <button
                        key={l}
                        onClick={() => setDisplayLang(l)}
                        className={cn(
                          "px-2.5 py-0.5 rounded-full text-[10px] font-bold transition-colors",
                          displayLang === l ? "bg-foreground text-background" : "text-muted-foreground"
                        )}
                      >
                        {l.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Engagement row — B&W */}
              <div className="flex items-center gap-5">
                <button
                  onClick={() => {
                    if (!user) { toast({ title: lang === "th" ? "เข้าสู่ระบบเพื่อกดไลค์" : "Sign in to like", duration: 1500 }); return; }
                    likeMutation.mutate();
                  }}
                  disabled={likeMutation.isPending}
                  className={cn(
                    "flex items-center gap-1.5 transition-colors",
                    isLiked ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <Heart className={cn("w-4 h-4", isLiked && "fill-current")} />
                  <span className="text-xs font-semibold">{likeCount > 0 ? likeCount : ""}</span>
                </button>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <MessagesSquare className="w-4 h-4" />
                  <span className="text-xs font-semibold">{commentCount > 0 ? commentCount : ""}</span>
                </div>
              </div>
            </div>

            <div className="mx-5 border-t border-border" />

            {/* Article text */}
            {paragraphs.length > 0 && (
              <div className="px-5 pt-4 flex flex-col gap-3">
                {paragraphs.map((para, i) => (
                  <p key={i} className="text-sm text-foreground leading-relaxed">{para}</p>
                ))}
              </div>
            )}

            {/* Related items */}
            {cat && cat !== "other" && (
              <RelatedWikiItems category={cat} currentPageId={pageId!} lang={lang} />
            )}

            {/* ── Comments list ── */}
            <div className="mt-5 border-t border-border">
              <div className="flex items-center gap-2 px-4 py-3">
                <MessagesSquare className="w-4 h-4 text-muted-foreground" />
                <h2 className="font-display font-bold text-sm text-foreground">
                  {lang === "th" ? "ความคิดเห็น" : "Comments"}{commentCount > 0 ? ` (${commentCount})` : ""}
                </h2>
              </div>
              <div className="px-4 pb-4">
                {rootComments.length === 0 ? (
                  <div className="pt-6 pb-12 text-center">
                    <MessagesSquare className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">{lang === "th" ? "ยังไม่มีความคิดเห็น" : "No comments yet"}</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {rootComments.map(c => (
                      <div key={c.id} className="space-y-3">
                        <CommentRow c={c} />
                        {(repliesMap.get(c.id) ?? []).map(reply => (
                          <div key={reply.id}>
                            <CommentRow c={reply} isReply />
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Comment input — pinned at bottom ── */}
      {user && (
        <div
          className="flex flex-col gap-0 px-4 pt-3 border-t border-border flex-shrink-0"
          style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px) + 12px)" }}
        >
          {replyingTo && (
            <div className="flex items-center gap-1.5 mb-2 px-1">
              <CornerDownRight className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {lang === "th" ? "ตอบ" : "Reply to"} @{replyingTo.username}
              </span>
              <button type="button" onClick={() => setReplyingTo(null)} className="ml-auto text-muted-foreground hover:text-foreground text-xs leading-none">✕</button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg overflow-hidden bg-black border border-white/10 flex-shrink-0 flex items-center justify-center">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs font-bold text-white">{user.displayName?.[0]?.toUpperCase() ?? "T"}</span>
              )}
            </div>
            <div className="flex-1 bg-secondary rounded-2xl px-3.5 py-1.5">
              <textarea
                className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none"
                placeholder={replyingTo ? `${lang === "th" ? "ตอบ" : "Reply to"} @${replyingTo.username}...` : (lang === "th" ? "เขียนความคิดเห็น..." : "Write a comment...")}
                value={comment}
                rows={1}
                onChange={e => {
                  setComment(e.target.value);
                  e.currentTarget.style.height = "auto";
                  e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 96)}px`;
                }}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitComment(); } }}
                maxLength={500}
              />
            </div>
            <button
              onClick={submitComment}
              disabled={!comment.trim() || submitting}
              className="w-9 h-9 rounded-full bg-foreground text-background flex items-center justify-center flex-shrink-0 disabled:opacity-40 active:opacity-70 transition-opacity"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
