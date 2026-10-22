import { useState } from "react";
import { Check, Disc3, ListMusic, Music2, RotateCcw, Star, CircleOff } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

export type MusicEntity = "song" | "album" | "artist";
export type MusicItem = {
  providerId: string;
  entity: MusicEntity;
  name: string;
  artistName?: string | null;
  collectionName?: string | null;
  artworkUrl?: string | null;
  previewUrl?: string | null;
  itemUrl?: string | null;
  genre?: string | null;
  releaseDate?: string | null;
  durationMs?: number | null;
  trackCount?: number | null;
  raw?: Record<string, unknown>;
};

export function MusicArtwork({
  item,
  className,
  square = false,
}: {
  item?: Pick<MusicItem, "artworkUrl" | "name"> | null;
  className?: string;
  square?: boolean;
}) {
  return (
    <div className={cn(
      "relative flex shrink-0 items-center justify-center overflow-hidden bg-secondary border border-border",
      square ? "rounded-2xl" : "rounded-full",
      className,
    )}>
      {item?.artworkUrl
        ? <img src={item.artworkUrl} alt={item.name} loading="lazy" className="h-full w-full object-cover" />
        : square
          ? <ListMusic className="h-1/3 w-1/3 text-muted-foreground" />
          : <Disc3 className="h-1/3 w-1/3 text-muted-foreground" />}
    </div>
  );
}

export function MusicSearchRow({
  item,
  onSelect,
  selected = false,
}: {
  item: MusicItem;
  onSelect?: () => void;
  selected?: boolean;
}) {
  const albumId = String(item.raw?.["collectionId"] ?? "");
  const artistId = String(item.raw?.["artistId"] ?? "");
  const entity: MusicEntity = item.entity;

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex w-full items-center gap-3 rounded-2xl border border-border bg-background p-3 text-left active:bg-secondary"
      >
        <MusicArtwork item={item} square={entity !== "song"} className="h-14 w-14" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-foreground">{item.name}</span>
          {item.artistName && item.entity !== "artist" && (
            <span className="block truncate text-xs text-muted-foreground">{item.artistName}</span>
          )}
          {item.collectionName && item.entity === "song" && (
            <span className="block truncate text-[11px] text-muted-foreground/80">{item.collectionName}</span>
          )}
        </span>
        {item.genre && <span className="max-w-24 truncate rounded-full bg-secondary px-2 py-1 text-[10px] text-muted-foreground">{item.genre}</span>}
        {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-background p-3">
      <Link href={`/music/${entity}/${item.providerId}`} className="shrink-0">
        <MusicArtwork item={item} square={entity !== "song"} className="h-14 w-14" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/music/${entity}/${item.providerId}`} className="block truncate text-sm font-bold text-foreground">
          {item.name}
        </Link>
        {item.artistName && item.entity !== "artist" && (
          <Link href={artistId ? `/music/artist/${artistId}` : "#"} className="block truncate text-xs text-muted-foreground">
            {item.artistName}
          </Link>
        )}
        {item.collectionName && item.entity === "song" && (
          <Link href={albumId ? `/music/album/${albumId}` : "#"} className="block truncate text-[11px] text-muted-foreground/80">
            {item.collectionName}
          </Link>
        )}
      </div>
      {item.genre && <span className="max-w-24 truncate rounded-full bg-secondary px-2 py-1 text-[10px] text-muted-foreground">{item.genre}</span>}
    </div>
  );
}

export type VinylPost = {
  id: string;
  userId: string;
  trackId: string;
  itemSnapshot: MusicItem;
  rating?: string | number | null;
  ratingType?: "star" | "blackhole" | null;
  hideRating?: boolean;
  caption: string;
  shape: "vinyl" | "square";
  createdAt: string | Date;
  editedAt?: string | Date | null;
  user?: { username?: string | null; displayName?: string | null; avatarUrl?: string | null };
};

export function VinylCard({ post }: { post: VinylPost }) {
  const [showBack, setShowBack] = useState(false);
  const shapeClass = post.shape === "square" ? "rounded-2xl" : "rounded-full";
  const showRating = post.rating != null && !post.hideRating;
  return (
    <article className="border-b border-border px-4 py-4">
      <div className="mb-3 flex items-center gap-2">
        <Link href={`/profile/${post.user?.username ?? ""}`} className="truncate text-xs font-semibold text-foreground">
          {post.user?.displayName || `@${post.user?.username ?? ""}`}
        </Link>
        <span className="text-[11px] text-muted-foreground">{new Date(post.createdAt).toLocaleDateString()}</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="relative h-[88px] w-[88px] shrink-0">
          <Link href={`/music/vinyl/${post.id}`} aria-label={post.itemSnapshot.name}>
            {showBack ? (
              <div className={cn("flex h-[88px] w-[88px] flex-col items-center justify-center overflow-hidden border border-border bg-secondary px-2 py-2 text-center", shapeClass)}>
                <span className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground">ความทรงจำ</span>
                <span className="mt-1 line-clamp-4 text-[9px] font-semibold leading-tight text-foreground">
                  {post.caption || "ยังไม่มีบันทึกความทรงจำ"}
                </span>
                {showRating && (
                  <span className="mt-1 flex items-center gap-0.5 text-[9px] font-bold text-amber-500">
                    {post.ratingType === "blackhole" ? <CircleOff className="h-3 w-3" /> : <Star className="h-3 w-3 fill-current" />}
                    {post.rating}
                  </span>
                )}
              </div>
            ) : (
              <MusicArtwork
                item={post.itemSnapshot}
                square={post.shape === "square"}
                className={cn("h-[88px] w-[88px]", post.shape === "vinyl" && "ring-4 ring-zinc-800")}
              />
            )}
          </Link>
          <button
            type="button"
            onClick={() => setShowBack(current => !current)}
            aria-label={showBack ? "ดูด้านหน้า Vinyl" : "ดูความทรงจำด้านหลัง Vinyl"}
            title={showBack ? "ดูด้านหน้า" : "ดูความทรงจำด้านหลัง"}
            className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full border border-background bg-foreground text-background shadow"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <Link href={`/music/song/${post.trackId}`} className="block line-clamp-2 text-sm font-bold text-foreground">
            {post.itemSnapshot.name}
          </Link>
          <p className="mt-1 truncate text-xs text-muted-foreground">{post.itemSnapshot.artistName}</p>
          {showRating && (
            <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-500">
              {post.ratingType === "blackhole" ? <CircleOff className="h-3 w-3" /> : <Star className="h-3 w-3 fill-current" />}
              {post.rating} / 5
            </p>
          )}
          {post.caption && <p className="mt-2 line-clamp-2 text-xs text-foreground/75">{post.caption}</p>}
        </div>
      </div>
    </article>
  );
}

export function PlaylistCard({
  playlist,
}: {
  playlist: {
    id: string;
    title: string;
    description?: string;
    coverUrl?: string | null;
    tracks?: Array<{ itemSnapshot: MusicItem }>;
    user?: { username?: string | null; displayName?: string | null };
  };
}) {
  const first = playlist.tracks?.[0]?.itemSnapshot;
  return (
    <Link href={`/music/playlist/${playlist.id}`}>
      <article className="flex items-center gap-3 border-b border-border px-4 py-4 active:bg-secondary/70">
        <MusicArtwork item={first ?? { artworkUrl: playlist.coverUrl, name: playlist.title }} square className="h-14 w-14" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-foreground">{playlist.title}</p>
          {playlist.description && <p className="line-clamp-1 text-xs text-muted-foreground">{playlist.description}</p>}
          {playlist.user?.username && <p className="mt-1 text-[11px] text-muted-foreground">@{playlist.user.username}</p>}
        </div>
        <Music2 className="h-4 w-4 shrink-0 text-muted-foreground" />
      </article>
    </Link>
  );
}
