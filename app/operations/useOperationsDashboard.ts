"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { authedHeaders } from "@/components/auth/AuthGate";
import type {
  Command,
  OperationsMonth,
  summarize,
} from "@/lib/operations/domain";
type View = {
  state: OperationsMonth;
  summary: ReturnType<typeof summarize>;
  mode: string;
  source: string;
  automaticCollection: boolean;
};

export function useOperationsDashboard(local: boolean, initialMonth: string) {
  const [month, setMonth] = useState(initialMonth),
    [view, setView] = useState<View | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const generation = useRef(0);
  const reading = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const invalidate = useCallback(() => {
    generation.current += 1;
    reading.current?.abort();
    reading.current = null;
  }, []);
  const request = useCallback(
    async (method: "GET" | "PUT", body?: unknown, signal?: AbortSignal) => {
      const headers = local ? {} : await authedHeaders();
      signal?.throwIfAborted();
      const response = await fetch(`/api/operations?month=${month}`, {
        method,
        cache: "no-store",
        signal,
        headers: {
          ...headers,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "요청을 처리하지 못했습니다.");
      return result as View;
    },
    [local, month],
  );
  const read = useCallback(() => {
    if (saving.current) return Promise.resolve();
    invalidate();
    const current = generation.current;
    const controller = new AbortController();
    reading.current = controller;
    return request("GET", undefined, controller.signal)
      .then((result) => {
        if (current === generation.current) setView(result);
      })
      .catch((e) => {
        if (current === generation.current) {
          setView(null);
          setError(e instanceof Error ? e.message : "불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (current === generation.current) {
          reading.current = null;
          setLoading(false);
        }
      });
  }, [request, invalidate]);
  const load = useCallback(async () => {
    if (saving.current) return;
    setLoading(true);
    setError("");
    await read();
  }, [read]);
  useEffect(() => {
    void read();
    return invalidate;
  }, [read, invalidate]);
  async function save(command: Command) {
    if (!view || loading || saving.current || view.state.goal.month !== month) return;
    saving.current = true;
    invalidate();
    const current = generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await request("PUT", {
        month,
        expectedRevision: view.state.revision,
        command,
      });
      if (current === generation.current) {
        setView(updated);
        setNotice("저장했습니다. 다음 행동과 남은 목표를 확인하세요.");
      }
    } catch (e) {
      if (current === generation.current)
        setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      saving.current = false;
      if (current === generation.current) setBusy(false);
    }
  }

  function selectMonth(next: string) {
    if (!next || next === month || saving.current) return;
    invalidate();
    setLoading(true);
    setView(null);
    setError("");
    setNotice("");
    setMonth(next);
  }
  return { month, view, loading, busy, error, notice, load, save, selectMonth };
}
