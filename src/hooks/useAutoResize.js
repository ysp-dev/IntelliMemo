import { useEffect } from "react";

export function useAutoResize(ref, value, trigger) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value, trigger]);
}
