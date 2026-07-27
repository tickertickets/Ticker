import { ReactNode } from "react";
import { BottomNav } from "./BottomNav";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex justify-center overflow-hidden"
      style={{ height: "100%", background: "var(--app-chrome)" }}
    >
      <div className="relative w-full max-w-[430px] h-full bg-background flex flex-col overflow-hidden shadow-[0_0_60px_rgba(0,0,0,0.08)]">
        {/* main fills remaining height above BottomNav — no pb needed on scroll containers */}
        <main className="relative flex-1 min-h-0 w-full overflow-hidden">
          {children}
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
