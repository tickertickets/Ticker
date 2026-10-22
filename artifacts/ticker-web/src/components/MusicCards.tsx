import { Disc3, ListMusic, Music2 } from "lucide-react";
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

export function MusicSearchRow({ item }: { item: MusicItem }) {
  const albumId = String(item.raw?.["collectionId"] ?? "");
  const artistId = String(item.raw?.["artistId"] ?? "");
  const entity: MusicEntity = item.entity;
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
  caption: string;
  shape: "vinyl" | "square";
  createdAt: string | Date;
  editedAt?: string | Date | null;
  user?: { username?: string | null; displayName?: string | null; avatarUrl?: string | null };
};

export function VinylCard({ post }: { post: VinylPost }) {
  return (
    <article className="border-b border-border px-4 py-4">
      <div className="mb-3 flex items-center gap-2">
        <Link href={`/profile/${post.user?.username ?? ""}`} className="truncate text-xs font-semibold text-foreground">
          {post.user?.displayName || `@${post.user?.username ?? ""}`}
        </Link>
        <span className="text-[11px] text-muted-foreground">{new Date(post.createdAt).toLocaleDateString()}</span>
      </div>
      <div className="flex items-center gap-4">
        <Link href={`/music/vinyl/${post.id}`} className="shrink-0">
          <MusicArtwork
            item={post.itemSnapshot}
            square={post.shape === "square"}
            className={cn(post.shape === "square" ? "h-[88px] w-[88px]" : "h-[88px] w-[88px] ring-4 ring-zinc-800")}
          />
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={`/music/song/${post.trackId}`} className="block line-clamp-2 text-sm font-bold text-foreground">
            {post.itemSnapshot.name}
          </Link>
          <p className="mt-1 truncate text-xs text-muted-foreground">{post.itemSnapshot.artistName}</p>
          {post.rating != null && <p className="mt-1 text-xs font-semibold text-amber-500">{post.rating} / 5</p>}
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
