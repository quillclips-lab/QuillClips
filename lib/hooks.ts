"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

type Updater<T> = T | null | ((prev: T | null) => T | null);

/** Fetch + optional polling. Polling pauses while the tab is hidden; data from the previous path stays visible while the next loads. */
export function usePoll<T>(path: string | null, intervalMs = 0) {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    const load = async () => {
      try {
        const data = await api<T>(path);
        if (alive) setState({ data, error: null });
      } catch (e) {
        if (alive) setState((s) => ({ ...s, error: (e as Error).message }));
      }
    };
    load();
    if (!intervalMs) {
      return () => {
        alive = false;
      };
    }
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [path, intervalMs, tick]);

  const setData = useCallback((u: Updater<T>) => {
    setState((s) => ({ ...s, data: typeof u === "function" ? (u as (p: T | null) => T | null)(s.data) : u }));
  }, []);

  return { data: state.data, error: state.error, loading: state.data === null && !state.error, refresh, setData };
}

export function useToast() {
  const [toast, setToast] = useState<{ msg: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  return { toast, show: (msg: string, tone: "ok" | "err" = "ok") => setToast({ msg, tone }) };
}
