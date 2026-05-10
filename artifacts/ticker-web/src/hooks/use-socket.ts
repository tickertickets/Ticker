import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSocket } from "@/lib/socket";
import { useAuth } from "@/hooks/use-auth";

/**
 * Joins the current user's personal WebSocket room so the server
 * can push feed:new events targeted specifically to followers.
 * Call once at the app root level.
 */
export function useSocketIdentify() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id) return;
    const socket = getSocket();

    const join = () => socket.emit("user:join", user.id);
    join();
    socket.on("connect", join);

    return () => {
      socket.off("connect", join);
    };
  }, [user?.id]);
}

/**
 * Listens for notification:new events and refetches notifications
 * immediately so party invites and other push notifications surface
 * in real-time without waiting for the poll interval.
 */
export function useSocketNotificationUpdates() {
  const qc = useQueryClient();

  useEffect(() => {
    const socket = getSocket();

    const handleNotificationNew = () => {
      qc.invalidateQueries({ queryKey: ["/api/notifications"] });
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    };

    socket.on("notification:new", handleNotificationNew);
    return () => { socket.off("notification:new", handleNotificationNew); };
  }, [qc]);
}

/**
 * Listens for chat:changed events and refreshes the chat unread badge +
 * conversations list immediately so users don't have to wait for the
 * polling interval to see a new message arrive or their unread count drop.
 */
export function useSocketChatUpdates() {
  const qc = useQueryClient();

  useEffect(() => {
    const socket = getSocket();
    const handleChatChanged = () => {
      qc.invalidateQueries({ queryKey: ["/api/chat/unread-count"] });
      qc.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    };
    socket.on("chat:changed", handleChatChanged);
    return () => { socket.off("chat:changed", handleChatChanged); };
  }, [qc]);
}

/**
 * Listens for follow:changed events and invalidates user-profile caches
 * so followerCount / followingCount / isFollowing update in real time on
 * every device viewing the affected profiles.
 */
export function useSocketFollowUpdates() {
  const qc = useQueryClient();

  useEffect(() => {
    const socket = getSocket();

    const handleFollowChanged = () => {
      // Invalidate every cached user profile + follower/following lists.
      // Profile cache keys are generated per-username so we invalidate broadly.
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey;
          if (!Array.isArray(k) || typeof k[0] !== "string") return false;
          const key = k[0] as string;
          return (
            key.startsWith("/api/users/") ||
            key === "/api/users/me/profile" ||
            key.includes("followers") ||
            key.includes("following")
          );
        },
      });
    };

    socket.on("follow:changed", handleFollowChanged);
    return () => { socket.off("follow:changed", handleFollowChanged); };
  }, [qc]);
}

/**
 * Listens for feed:new events and invalidates ALL feed caches
 * (tickets feed, mixed feed, following feed) so any new ticket/chain
 * post from a followed user surfaces immediately.
 */
export function useSocketFeedUpdates() {
  const qc = useQueryClient();

  useEffect(() => {
    const socket = getSocket();

    const handleFeedNew = () => {
      qc.invalidateQueries({ queryKey: ["/api/tickets"] });
      qc.invalidateQueries({ queryKey: ["mixed-feed-discover"] });
      qc.invalidateQueries({ queryKey: ["mixed-feed"] });
    };

    socket.on("feed:new", handleFeedNew);
    return () => { socket.off("feed:new", handleFeedNew); };
  }, [qc]);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Patch commentCount in EVERY cached query that contains this ticket.
 * Handles all cache formats used across the app:
 *  1. Single ticket        { id, commentCount, ... }
 *  2. Ticket list          { tickets: [{ id, commentCount, ... }] }  — feed & profile
 *  3. Mixed feed items     { items: [{ type:"ticket", ticket:{...} }] }
 *
 * Exported so ticket-detail.tsx can call it immediately on add/delete
 * without waiting for the socket event to arrive.
 */
export function patchCommentCount(
  qc: ReturnType<typeof useQueryClient>,
  ticketId: string,
  delta: 1 | -1,
) {
  qc.setQueriesData<unknown>({ type: "all" }, (old: unknown) => {
    if (!old || typeof old !== "object") return old;
    const o = old as Record<string, unknown>;

    // Format 1: single ticket
    if (o["id"] === ticketId) {
      return { ...o, commentCount: Math.max(0, (Number(o["commentCount"]) || 0) + delta) };
    }

    // Format 2: { tickets: [...] }  — used by feed AND profile
    if (Array.isArray(o["tickets"])) {
      const arr = o["tickets"] as Array<Record<string, unknown>>;
      if (!arr.some((t) => t["id"] === ticketId)) return old;
      return {
        ...o,
        tickets: arr.map((t) =>
          t["id"] === ticketId
            ? { ...t, commentCount: Math.max(0, (Number(t["commentCount"]) || 0) + delta) }
            : t,
        ),
      };
    }

    // Format 3: { items: [...] } — mixed feed
    if (Array.isArray(o["items"])) {
      const arr = o["items"] as Array<Record<string, unknown>>;
      const hasTicket = arr.some(
        (item) =>
          item["type"] === "ticket" &&
          (item["ticket"] as Record<string, unknown>)?.["id"] === ticketId,
      );
      if (!hasTicket) return old;
      return {
        ...o,
        items: arr.map((item) => {
          if (
            item["type"] === "ticket" &&
            (item["ticket"] as Record<string, unknown>)?.["id"] === ticketId
          ) {
            const t = item["ticket"] as Record<string, unknown>;
            return {
              ...item,
              ticket: { ...t, commentCount: Math.max(0, (Number(t["commentCount"]) || 0) + delta) },
            };
          }
          return item;
        }),
      };
    }

    return old;
  });
}

/**
 * Joins a ticket's WebSocket room and listens for real-time like/comment
 * updates, patching the relevant queries in ALL cache formats.
 */
export function useSocketWikiUpdates(wikiPageId: string | undefined, displayLang: string) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!wikiPageId) return;
    const socket = getSocket();

    socket.emit("wiki:join", wikiPageId);

    const handleLiked = ({ likeCount }: { wikiPageId: string; likeCount: number }) => {
      qc.setQueryData<unknown>(["/api/wiki", wikiPageId, displayLang], (old: unknown) => {
        if (!old || typeof old !== "object") return old;
        return { ...(old as object), likeCount };
      });
    };

    const handleCommentNew = () => {
      qc.invalidateQueries({ queryKey: ["/api/wiki", wikiPageId, "comments"] });
      qc.setQueryData<unknown>(["/api/wiki", wikiPageId, displayLang], (old: unknown) => {
        if (!old || typeof old !== "object") return old;
        const o = old as Record<string, unknown>;
        return { ...o, commentCount: (Number(o["commentCount"] ?? 0)) + 1 };
      });
    };

    const handleCommentDeleted = () => {
      qc.invalidateQueries({ queryKey: ["/api/wiki", wikiPageId, "comments"] });
      qc.setQueryData<unknown>(["/api/wiki", wikiPageId, displayLang], (old: unknown) => {
        if (!old || typeof old !== "object") return old;
        const o = old as Record<string, unknown>;
        return { ...o, commentCount: Math.max(0, (Number(o["commentCount"] ?? 0)) - 1) };
      });
    };

    socket.on("wiki:liked", handleLiked);
    socket.on("wiki:comment:new", handleCommentNew);
    socket.on("wiki:comment:deleted", handleCommentDeleted);

    return () => {
      socket.emit("wiki:leave", wikiPageId);
      socket.off("wiki:liked", handleLiked);
      socket.off("wiki:comment:new", handleCommentNew);
      socket.off("wiki:comment:deleted", handleCommentDeleted);
    };
  }, [wikiPageId, displayLang, qc]);
}

export function useSocketTicketUpdates(ticketId: string | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!ticketId) return;
    const socket = getSocket();

    socket.emit("ticket:join", ticketId);

    // ── ticket:liked — update likeCount in every cache ──────────────────────
    const handleLiked = ({ likeCount }: { ticketId: string; likeCount: number }) => {
      qc.setQueriesData<unknown>({ type: "all" }, (old: unknown) => {
        if (!old || typeof old !== "object") return old;
        const o = old as Record<string, unknown>;

        if (o["id"] === ticketId) {
          return { ...o, likeCount };
        }
        if (Array.isArray(o["tickets"])) {
          const arr = o["tickets"] as Array<Record<string, unknown>>;
          if (!arr.some((t) => t["id"] === ticketId)) return old;
          return { ...o, tickets: arr.map((t) => t["id"] === ticketId ? { ...t, likeCount } : t) };
        }
        if (Array.isArray(o["items"])) {
          const arr = o["items"] as Array<Record<string, unknown>>;
          const hasTicket = arr.some(
            (item) =>
              item["type"] === "ticket" &&
              (item["ticket"] as Record<string, unknown>)?.["id"] === ticketId,
          );
          if (!hasTicket) return old;
          return {
            ...o,
            items: arr.map((item) => {
              if (
                item["type"] === "ticket" &&
                (item["ticket"] as Record<string, unknown>)?.["id"] === ticketId
              ) {
                return { ...item, ticket: { ...(item["ticket"] as object), likeCount } };
              }
              return item;
            }),
          };
        }
        return old;
      });
    };

    // ── comment:new — increment commentCount + refetch comment list ──────────
    const handleCommentNew = () => {
      qc.invalidateQueries({ queryKey: [`/api/tickets/${ticketId}/comments`] });
      patchCommentCount(qc, ticketId, +1);
    };

    // ── comment:deleted — decrement commentCount + refetch comment list ──────
    const handleCommentDeleted = () => {
      qc.invalidateQueries({ queryKey: [`/api/tickets/${ticketId}/comments`] });
      patchCommentCount(qc, ticketId, -1);
    };

    socket.on("ticket:liked", handleLiked);
    socket.on("comment:new", handleCommentNew);
    socket.on("comment:deleted", handleCommentDeleted);

    return () => {
      socket.emit("ticket:leave", ticketId);
      socket.off("ticket:liked", handleLiked);
      socket.off("comment:new", handleCommentNew);
      socket.off("comment:deleted", handleCommentDeleted);
    };
  }, [ticketId, qc]);
}
