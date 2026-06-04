import { useState, useEffect, useCallback } from "react";

const HIDDEN_CHANGED = "ticker:hidden-changed";
const SESSION_KEY    = "ticker_hidden_ids";

function readIds(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

function writeIds(ids: Set<string>) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify([...ids]));
  } catch {}
}

export function useHiddenItems() {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(readIds);

  useEffect(() => {
    const sync = () => setHiddenIds(readIds());
    window.addEventListener(HIDDEN_CHANGED, sync);
    return () => window.removeEventListener(HIDDEN_CHANGED, sync);
  }, []);

  const hideItem = useCallback((id: string) => {
    setHiddenIds(prev => {
      const next = new Set(prev);
      next.add(id);
      writeIds(next);
      window.dispatchEvent(new Event(HIDDEN_CHANGED));
      return next;
    });
    fetch("/api/feed/signal", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: id, itemType: "ticket", signalType: "hide" }),
    }).catch(() => {});
  }, []);

  const hideChain = useCallback((id: string) => {
    setHiddenIds(prev => {
      const next = new Set(prev);
      next.add(id);
      writeIds(next);
      window.dispatchEvent(new Event(HIDDEN_CHANGED));
      return next;
    });
    fetch("/api/feed/signal", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: id, itemType: "chain", signalType: "hide" }),
    }).catch(() => {});
  }, []);

  const restoreItem = useCallback((id: string) => {
    setHiddenIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      writeIds(next);
      window.dispatchEvent(new Event(HIDDEN_CHANGED));
      return next;
    });
    fetch(`/api/feed/signal/${id}`, { method: "DELETE", credentials: "include" }).catch(() => {});
  }, []);

  return { hiddenIds, hideItem, hideChain, restoreItem };
}
