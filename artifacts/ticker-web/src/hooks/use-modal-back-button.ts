import { useEffect } from "react";

export function useModalBackButton(onClose: () => void) {
  useEffect(() => {
    const key = `modal-${Date.now()}-${Math.random()}`;
    history.pushState({ _modalKey: key }, "");

    const handlePopState = () => {
      onClose();
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (history.state?._modalKey === key) {
        history.back();
      }
    };
  }, []);
}
