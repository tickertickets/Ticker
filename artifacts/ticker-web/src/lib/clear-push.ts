// Tell the active service worker to close any displayed notifications
// for the given tag. Called when the user opens the relevant view so
// the push notification on their device disappears.
export async function clearPushByTag(tag: string): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    // Prefer the active worker; fall back to controller.
    const target = reg.active ?? navigator.serviceWorker.controller;
    if (!target) return;
    target.postMessage({ type: "clear-notifications", tag });
  } catch {
    // ignore
  }
}
