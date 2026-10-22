import { useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bookmark, Check, Disc3, Loader2, Music2, Plus, Search, Square, UserRound } from "lucide-react";
import { useDebounceValue } from "usehooks-ts";
import { useAuth } from "@/hooks/use-auth";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { MusicArtwork, MusicSearchRow, type MusicItem, type MusicEntity } from "@/components/MusicCards";

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.message || body?.error || `Request failed (${response.status})`);
  return body as T;
}

function MusicPageHeader({ title }: { title: string }) {
  const [, navigate] = useLocation();
  return (
    <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
      <button
        onClick={() => {
          if (window.history.length > 1) window.history.back();
          else navigate("/search");
        }}
        className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-foreground"
        aria-label="Back"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <h1 className="min-w-0 flex-1 truncate font-display text-base font-bold text-foreground">{title}</h1>
    </div>
  );
}

export function MusicDetailPage() {
  const [, itemParams] = useRoute("/music/:entity/:id");
  const [, vinylParams] = useRoute("/music/vinyl/:id");
  const [, playlistParams] = useRoute("/music/playlist/:id");
  const [, navigate] = useLocation();
  const { lang } = useLang();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isVinyl = !!vinylParams?.id;
  const isPlaylist = !!playlistParams?.id;
  const entity = (itemParams?.entity ?? "song") as MusicEntity;
  const id = vinylParams?.id ?? playlistParams?.id ?? itemParams?.id ?? "";
  const endpoint = isVinyl
    ? `/api/music/vinyls/${encodeURIComponent(id)}`
    : isPlaylist
      ? `/api/music/playlists/${encodeURIComponent(id)}`
      : `/api/music/lookup/${entity}/${encodeURIComponent(id)}`;
  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["music-detail", endpoint],
    queryFn: () => apiJson(endpoint),
    enabled: !!id,
    staleTime: 60_000,
  });
  const post = isVinyl ? data : null;
  const playlist = isPlaylist ? data : null;
  const item = isVinyl ? post?.itemSnapshot : isPlaylist ? null : data?.item as MusicItem | undefined;
  const saveStatusKey = ["music-save-status", user?.id, entity, id] as const;
  const { data: saveStatus, isLoading: saveStatusLoading } = useQuery<{ saved: boolean }>({
    queryKey: saveStatusKey,
    queryFn: () => apiJson(`/api/music/saves/${entity}/${encodeURIComponent(id)}`),
    enabled: !!user && !!item,
    staleTime: 30_000,
  });
  const isSaved = !!saveStatus?.saved;
  const saveMutation = useMutation({
    mutationFn: async () => {
      const nextSaved = !isSaved;
      if (isSaved) {
        await apiJson(`/api/music/saves/${item!.entity}/${item!.providerId}`, { method: "DELETE" });
      } else {
        await apiJson("/api/music/saves", { method: "POST", body: JSON.stringify({ entity: item!.entity, providerId: item!.providerId }) });
      }
      return nextSaved;
    },
    onSuccess: saved => {
      queryClient.setQueryData(saveStatusKey, { saved });
      queryClient.invalidateQueries({ queryKey: ["profile-music", user?.username] });
      queryClient.invalidateQueries({ queryKey: ["music-trending"] });
    },
  });
  const title = playlist?.title ?? post?.itemSnapshot?.name ?? item?.name ?? (lang === "th" ? "เพลง" : "Music");
  const raw = item?.raw ?? {};
  const albumId = String(raw["collectionId"] ?? "");
  const artistId = String(raw["artistId"] ?? "");

  if (isLoading) return <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (error || (!item && !playlist && !post)) return <div className="p-8 text-center text-sm text-muted-foreground">{lang === "th" ? "ไม่พบข้อมูลเพลง" : "Music item not found"}</div>;

  return (
    <div
      className="h-full overflow-y-auto bg-background"
      data-music-profile-dropzone={!isVinyl && !isPlaylist && entity === "song" ? "true" : undefined}
    >
      <MusicPageHeader title={title} />
      {playlist ? (
        <div className="px-5 py-6">
          <div className="flex items-center gap-4">
            <MusicArtwork item={{ artworkUrl: playlist.coverUrl, name: playlist.title }} square className="h-24 w-24" />
            <div className="min-w-0">
              <h2 className="font-display text-xl font-bold text-foreground">{playlist.title}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{playlist.user?.displayName ?? `@${playlist.user?.username ?? ""}`}</p>
              {playlist.description && <p className="mt-2 text-sm text-muted-foreground">{playlist.description}</p>}
            </div>
          </div>
          <div className="mt-5 divide-y divide-border">
            {(playlist.tracks ?? []).map((track: any, index: number) => (
              <div key={track.trackId} className="flex items-center gap-3 py-3">
                <span className="w-5 text-right text-xs text-muted-foreground">{index + 1}</span>
                <MusicArtwork item={track.itemSnapshot} square className="h-11 w-11" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{track.itemSnapshot.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{track.itemSnapshot.artistName}</p>
                </div>
                <a href={track.itemSnapshot.itemUrl ?? "#"} target="_blank" rel="noreferrer" className="text-xs text-primary">
                  iTunes
                </a>
              </div>
            ))}
          </div>
        </div>
      ) : item ? (
        <div className="px-5 py-7">
          <div className="flex flex-col items-center text-center">
            <MusicArtwork item={item} square={entity !== "song"} className={cn(entity === "song" ? "h-48 w-48 ring-8 ring-zinc-900" : "h-48 w-48")} />
            <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{item.entity}</p>
            <h2 className="mt-1 max-w-full text-xl font-black text-foreground">{item.name}</h2>
            {item.artistName && <p className="mt-1 text-sm text-muted-foreground">{item.artistName}</p>}
            {item.genre && <p className="mt-2 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">{item.genre}</p>}
            {item.releaseDate && <p className="mt-1 text-xs text-muted-foreground">{new Date(item.releaseDate).getFullYear()}</p>}
            {item.previewUrl && <audio className="mt-5 w-full max-w-sm" controls preload="none" src={item.previewUrl} />}
            {user && (
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || saveStatusLoading}
                className="mt-5 flex h-11 items-center gap-2 rounded-2xl border border-border bg-secondary px-4 text-sm font-bold text-foreground disabled:opacity-60"
              >
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : isSaved ? <Check className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                {isSaved ? (lang === "th" ? "บันทึกแล้ว" : "Saved") : (lang === "th" ? "บันทึก" : "Save")}
              </button>
            )}
            {item.itemUrl && <a href={item.itemUrl} target="_blank" rel="noreferrer" className="mt-3 text-xs font-semibold text-primary">Open in iTunes</a>}
          </div>
          <div className="mt-7 grid grid-cols-2 gap-2">
            {albumId && entity === "song" && (
              <button onClick={() => navigate(`/music/album/${albumId}`)} className="rounded-2xl border border-border p-3 text-left">
                <p className="text-[10px] text-muted-foreground">{lang === "th" ? "อัลบั้ม" : "Album"}</p>
                <p className="mt-1 truncate text-xs font-bold text-foreground">{item.collectionName}</p>
              </button>
            )}
            {artistId && entity !== "artist" && (
              <button onClick={() => navigate(`/music/artist/${artistId}`)} className="rounded-2xl border border-border p-3 text-left">
                <p className="text-[10px] text-muted-foreground">{lang === "th" ? "ศิลปิน" : "Artist"}</p>
                <p className="mt-1 truncate text-xs font-bold text-foreground">{item.artistName}</p>
              </button>
            )}
          </div>
          {entity === "song" && user && (
            <button onClick={() => navigate(`/vinyl/new?track=${item.providerId}`)} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-foreground text-sm font-bold text-background">
              <Disc3 className="h-4 w-4" /> {lang === "th" ? "สร้าง Vinyl" : "Post a Vinyl"}
            </button>
          )}
        </div>
      ) : post ? (
        <div className="px-5 py-6">
          <div className="flex items-center justify-center">
            <MusicArtwork item={post.itemSnapshot} square={post.shape === "square"} className="h-64 w-64 ring-8 ring-zinc-900" />
          </div>
          <div className="mt-6 text-center">
            <h2 className="text-lg font-black text-foreground">{post.itemSnapshot.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{post.itemSnapshot.artistName}</p>
            {post.rating != null && <p className="mt-2 font-bold text-amber-500">{post.rating} / 5</p>}
            {post.caption && <p className="mt-4 whitespace-pre-wrap text-sm text-foreground/80">{post.caption}</p>}
            {post.user?.username && <p className="mt-5 text-xs text-muted-foreground">@{post.user.username}</p>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CreateVinylPage() {
  const [, navigate] = useLocation();
  const { lang } = useLang();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounceValue(query, 450);
  const [selected, setSelected] = useState<MusicItem | null>(null);
  const [rating, setRating] = useState("");
  const [caption, setCaption] = useState("");
  const [shape, setShape] = useState<"vinyl" | "square">("vinyl");
  const [isPrivate, setIsPrivate] = useState(false);
  const preselectedId = new URLSearchParams(window.location.search).get("track");
  const { data, isLoading } = useQuery<{ results: MusicItem[] }>({
    queryKey: ["music-create-search", debouncedQuery],
    queryFn: () => apiJson(`/api/music/search?q=${encodeURIComponent(debouncedQuery)}&entity=song&limit=12`),
    enabled: debouncedQuery.trim().length >= 2 && !selected,
  });
  const createMutation = useMutation({
    mutationFn: () => apiJson<{ post: { id: string } }>("/api/music/vinyls", {
      method: "POST",
      body: JSON.stringify({ trackId: selected?.providerId, rating: rating || null, caption, shape, isPrivate }),
    }),
    onSuccess: ({ post }) => {
      queryClient.invalidateQueries({ queryKey: ["music-feed"] });
       queryClient.invalidateQueries({ queryKey: ["profile-music", user?.username] });
      navigate(`/music/vinyl/${post.id}`);
    },
  });
  if (!user) return <div className="p-8 text-center"><button onClick={() => navigate("/login")} className="font-bold text-primary">{lang === "th" ? "เข้าสู่ระบบเพื่อสร้าง Vinyl" : "Sign in to create a Vinyl"}</button></div>;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <MusicPageHeader title={lang === "th" ? "สร้าง Vinyl" : "Create Vinyl"} />
      <div className="space-y-5 px-4 py-5">
        {!selected ? (
          <>
            <label className="relative block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder={lang === "th" ? "ค้นหาเพลง" : "Search songs"} className="search-bar w-full pl-10" autoFocus={!preselectedId} />
            </label>
            {isLoading && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
            <div className="space-y-2">
              {(data?.results ?? []).map(item => (
                <button key={item.providerId} onClick={() => setSelected(item)} className="w-full text-left">
                  <MusicSearchRow item={item} />
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <button onClick={() => setSelected(null)} className="flex w-full items-center gap-3 rounded-2xl border border-border p-3 text-left">
              <MusicArtwork item={selected} className="h-14 w-14" />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-foreground">{selected.name}</p><p className="truncate text-xs text-muted-foreground">{selected.artistName}</p></div>
              <Check className="h-4 w-4 text-primary" />
            </button>
            <label className="block text-xs font-bold text-muted-foreground">{lang === "th" ? "คะแนน" : "Rating"}
              <select className="mt-2 h-11 w-full rounded-xl bg-secondary px-3 text-sm text-foreground" value={rating} onChange={event => setRating(event.target.value)}>
                <option value="">{lang === "th" ? "ไม่ให้คะแนน" : "No rating"}</option>
                {[5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5].map(value => <option key={value} value={value}>{value} / 5</option>)}
              </select>
            </label>
            <label className="block text-xs font-bold text-muted-foreground">{lang === "th" ? "บันทึกความรู้สึก" : "Caption"}
              <textarea className="mt-2 min-h-24 w-full resize-y rounded-xl bg-secondary p-3 text-sm text-foreground" maxLength={2000} value={caption} onChange={event => setCaption(event.target.value)} />
            </label>
            <div className="flex gap-2">
              <button onClick={() => setShape("vinyl")} className={cn("flex flex-1 items-center justify-center gap-2 rounded-xl border p-3 text-xs font-bold", shape === "vinyl" ? "border-foreground text-foreground" : "border-border text-muted-foreground")}><Disc3 className="h-4 w-4" /> Vinyl</button>
              <button onClick={() => setShape("square")} className={cn("flex flex-1 items-center justify-center gap-2 rounded-xl border p-3 text-xs font-bold", shape === "square" ? "border-foreground text-foreground" : "border-border text-muted-foreground")}><Square className="h-4 w-4" /> {lang === "th" ? "จัตุรัส" : "Square"}</button>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={isPrivate} onChange={event => setIsPrivate(event.target.checked)} /> {lang === "th" ? "โพสต์ส่วนตัว" : "Private post"}</label>
            {createMutation.error && <p className="text-xs text-red-500">{createMutation.error.message}</p>}
            <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-foreground text-sm font-bold text-background disabled:opacity-60">
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {lang === "th" ? "โพสต์ Vinyl" : "Post Vinyl"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function CreatePlaylistPage() {
  const [, navigate] = useLocation();
  const { lang } = useLang();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounceValue(query, 450);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tracks, setTracks] = useState<MusicItem[]>([]);
  const [isPrivate, setIsPrivate] = useState(false);
  const { data, isLoading } = useQuery<{ results: MusicItem[] }>({
    queryKey: ["music-playlist-search", debouncedQuery],
    queryFn: () => apiJson(`/api/music/search?q=${encodeURIComponent(debouncedQuery)}&entity=song&limit=12`),
    enabled: debouncedQuery.trim().length >= 2,
  });
  const createMutation = useMutation({
    mutationFn: () => apiJson<{ playlist: { id: string } }>("/api/music/playlists", {
      method: "POST",
      body: JSON.stringify({ title, description, trackIds: tracks.map(track => track.providerId), isPrivate }),
    }),
    onSuccess: ({ playlist }) => {
      queryClient.invalidateQueries({ queryKey: ["music-feed"] });
       queryClient.invalidateQueries({ queryKey: ["profile-music", user?.username] });
      navigate(`/music/playlist/${playlist.id}`);
    },
  });
  const selectedIds = useMemo(() => new Set(tracks.map(track => track.providerId)), [tracks]);
  if (!user) return <div className="p-8 text-center"><button onClick={() => navigate("/login")} className="font-bold text-primary">{lang === "th" ? "เข้าสู่ระบบเพื่อสร้าง Playlist" : "Sign in to create a playlist"}</button></div>;
  return (
    <div className="h-full overflow-y-auto bg-background">
      <MusicPageHeader title={lang === "th" ? "สร้าง Playlist" : "Create playlist"} />
      <div className="space-y-4 px-4 py-5">
        <input value={title} onChange={event => setTitle(event.target.value)} maxLength={100} placeholder={lang === "th" ? "ชื่อ Playlist" : "Playlist name"} className="search-bar w-full" />
        <textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} placeholder={lang === "th" ? "คำอธิบาย" : "Description"} className="min-h-20 w-full rounded-xl bg-secondary p-3 text-sm text-foreground" />
        <label className="relative block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder={lang === "th" ? "ค้นหาเพลงเพื่อเพิ่ม" : "Search songs to add"} className="search-bar w-full pl-10" />
        </label>
        {isLoading && <div className="flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
        <div className="space-y-2">
          {(data?.results ?? []).map(item => (
            <button key={item.providerId} onClick={() => setTracks(current => selectedIds.has(item.providerId) ? current.filter(track => track.providerId !== item.providerId) : [...current, item])} className="w-full text-left">
              <div className="relative">
                <MusicSearchRow item={item} />
                {selectedIds.has(item.providerId) && <Check className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />}
              </div>
            </button>
          ))}
        </div>
        {tracks.length > 0 && <div className="divide-y divide-border rounded-xl border border-border px-3">
          {tracks.map((track, index) => <div key={track.providerId} className="flex items-center gap-2 py-2"><span className="w-5 text-xs text-muted-foreground">{index + 1}</span><MusicArtwork item={track} className="h-9 w-9" /><span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{track.name}</span><button onClick={() => setTracks(current => current.filter(item => item.providerId !== track.providerId))} className="p-2 text-muted-foreground" aria-label="Remove"><Plus className="h-3.5 w-3.5 rotate-45" /></button></div>)}
        </div>}
        <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={isPrivate} onChange={event => setIsPrivate(event.target.checked)} /> {lang === "th" ? "Playlist ส่วนตัว" : "Private playlist"}</label>
        {createMutation.error && <p className="text-xs text-red-500">{createMutation.error.message}</p>}
        <button onClick={() => createMutation.mutate()} disabled={!title.trim() || tracks.length === 0 || createMutation.isPending} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-foreground text-sm font-bold text-background disabled:opacity-50">
          {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {lang === "th" ? `สร้าง Playlist (${tracks.length})` : `Create playlist (${tracks.length})`}
        </button>
      </div>
    </div>
  );
}
