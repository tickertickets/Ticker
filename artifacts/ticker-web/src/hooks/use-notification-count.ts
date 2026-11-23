import { useQuery } from "@tanstack/react-query";

async function fetchUnreadCount(): Promise<number> {
  const res = await fetch("/api/notifications/unread-count", { credentials: "include" });
  if (!res.ok) return 0;
  const data = await res.json();
  return data.unreadCount ?? 0;
}

export function useNotificationCount() {
  const { data } = useQuery({
    queryKey: ["notifications-unread-count"],
    queryFn: fetchUnreadCount,
    refetchInterval: 8_000,
    staleTime: 0,
  });
  return data ?? 0;
}
