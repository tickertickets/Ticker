const THEME_KEY_PREFIX = "ticker_theme";

export type Theme = "light" | "dark";

function themeKey(userId?: string | null): string {
  return userId ? `${THEME_KEY_PREFIX}_${userId}` : THEME_KEY_PREFIX;
}

export function getTheme(userId?: string | null): Theme {
  try {
    const saved = localStorage.getItem(themeKey(userId));
    if (saved === "dark" || saved === "light") return saved;
    // fallback: try legacy global key
    if (userId) {
      const legacy = localStorage.getItem(THEME_KEY_PREFIX);
      if (legacy === "dark" || legacy === "light") return legacy;
    }
  } catch {}
  return "light";
}

export function setTheme(theme: Theme, animate = false, userId?: string | null) {
  try {
    localStorage.setItem(themeKey(userId), theme);
  } catch {}
  applyTheme(theme, animate);
}

export function applyThemeForUser(userId: string | null | undefined) {
  const theme = getTheme(userId);
  applyTheme(theme, false);
}

export function resetTheme() {
  applyTheme("light", false);
}

export function applyTheme(theme: Theme, animate = false) {
  const html = document.documentElement;

  const apply = () => {
    if (theme === "dark") html.classList.add("dark");
    else html.classList.remove("dark");
  };

  if (!animate) {
    apply();
    return;
  }

  if (typeof (document as Document & { startViewTransition?: (cb: () => void) => void }).startViewTransition === "function") {
    (document as Document & { startViewTransition: (cb: () => void) => void }).startViewTransition(apply);
  } else {
    html.classList.add("theme-transitioning");
    void html.offsetWidth;
    apply();
    setTimeout(() => html.classList.remove("theme-transitioning"), 220);
  }
}
