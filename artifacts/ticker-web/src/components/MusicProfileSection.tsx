import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { MusicSearchRow, PlaylistCard, VinylCard, type MusicEntity, type MusicItem, type VinylPost } from "@/components/MusicCards";

type MusicProfileData = {
  counts: {
    vinyls: number;
    playlists: number;
    listenedPlaylists: number;
    savedSongs: number;
    savedAlbums: number;
    savedArtists: number;
  };
  vinyls: VinylPost[];
  playlists: Array<any>;
  listenedPlaylists: Array<any>;
  saves: Array<{ entity: MusicEntity; itemSnapshot: MusicItem }>;
};

type MusicTab = "vinyls" | "playlists" | "song" | "album" | "artist";

export function MusicProfileSection({ username, isOwn }: { username: string; isOwn: boolean }) {
  const { lang } = useLang();
  const [activeTab, setActiveTab] = useState<MusicTab>("vinyls");
  const [playlistView, setPlaylistView] = useState<"created" | "listened">("created");
  const { data, isLoading, isError } = useQuery<MusicProfileData>({
    queryKey: ["profile-music", username],
    queryFn: async () => {
      const response = await fetch(`/api/music/profile/${encodeURIComponent(username)}`, { credentials: "include" });
      if (!response.ok) throw new Error("Could not load music profile");
      return response.json();
    },
    enabled: !!username,
    staleTime: 30_000,
  });

  const counts = data?.counts;
  const tabs: Array<{ id: MusicTab; label: string; count: number }> = [
    { id: "vinyls", label: "Vinyl", count: counts?.vinyls ?? 0 },
    { id: "playlists", label: "Playlist", count: counts?.playlists ?? 0 },
    ...(isOwn ? [
      { id: "song" as const, label: lang === "th" ? "เพลง" : "Songs", count: counts?.savedSongs ?? 0 },
      { id: "album" as const, label: lang === "th" ? "อัลบั้ม" : "Albums", count: counts?.savedAlbums ?? 0 },
      { id: "artist" as const, label: lang === "th" ? "ศิลปิน" : "Artists", count: counts?.savedArtists ?? 0 },
    ] : []),
  ];
  const savedItems = (data?.saves ?? []).filter(item => item.entity === activeTab);
  const visiblePlaylists = playlistView === "created"
    ? data?.playlists ?? []
    : data?.listenedPlaylists ?? [];

  return (
    <section className="min-h-[35vh]">
      <div className="overflow-x-auto scrollbar-hide px-4 py-2">
        <div className="flex min-w-max justify-center gap-2">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                activeTab === tab.id ? "bg-foreground text-background" : "bg-secondary text-foreground/70",
              )}
            >
              {tab.label} <span className="ml-1 opacity-70">{tab.count}</span>
            </button>
          ))}
        </div>
      </div>

      {activeTab === "playlists" && isOwn && (
        <div className="flex justify-center gap-2 px-4 pb-2">
          <button
            type="button"
            onClick={() => setPlaylistView("created")}
            className={cn("rounded-xl px-3 py-1.5 text-xs font-semibold", playlistView === "created" ? "bg-foreground text-background" : "bg-secondary text-foreground/70")}
          >
            {lang === "th" ? "สร้างไว้" : "Created"} <span className="ml-1 opacity-70">{counts?.playlists ?? 0}</span>
          </button>
          <button
            type="button"
            onClick={() => setPlaylistView("listened")}
            className={cn("rounded-xl px-3 py-1.5 text-xs font-semibold", playlistView === "listened" ? "bg-foreground text-background" : "bg-secondary text-foreground/70")}
          >
            {lang === "th" ? "ฟังแล้ว" : "Listened"} <span className="ml-1 opacity-70">{counts?.listenedPlaylists ?? 0}</span>
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : isError ? (
        <p className="px-4 py-12 text-center text-sm text-muted-foreground">
          {lang === "th" ? "โหลดข้อมูลเพลงไม่สำเร็จ กรุณาลองใหม่" : "Could not load music profile. Please try again."}
        </p>
      ) : activeTab === "vinyls" ? (
        (data?.vinyls ?? []).length
          ? <div className="flex flex-col">{data!.vinyls.map(post => <VinylCard key={post.id} post={post} />)}</div>
          : <p className="px-4 py-12 text-center text-sm text-muted-foreground">{lang === "th" ? "ยังไม่มี Vinyl" : "No Vinyl posts yet"}</p>
      ) : activeTab === "playlists" ? (
        visiblePlaylists.length
          ? <div className="flex flex-col">{visiblePlaylists.map((playlist: any) => <PlaylistCard key={playlist.id} playlist={playlist} />)}</div>
          : <p className="px-4 py-12 text-center text-sm text-muted-foreground">
              {lang === "th"
                ? playlistView === "created" ? "ยังไม่มี Playlist ที่สร้าง" : "ยังไม่มี Playlist ที่ฟังแล้ว"
                : playlistView === "created" ? "No playlists created yet" : "No listened playlists yet"}
            </p>
      ) : savedItems.length ? (
        <div className="flex flex-col gap-2 px-4 py-3">
          {savedItems.map(item => <MusicSearchRow key={`${item.entity}:${item.itemSnapshot.providerId}`} item={item.itemSnapshot} />)}
        </div>
      ) : (
        <p className="px-4 py-12 text-center text-sm text-muted-foreground">
          {lang === "th" ? "ยังไม่มีรายการที่บันทึก" : "No saved items yet"}
        </p>
      )}
    </section>
  );
}
