"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHAT_SECONDS,
  FAST_CHAT_SECONDS,
  HUMANS_PER_GAME,
  PLAYER_COUNT,
  VOTE_SECONDS,
} from "@/lib/game/engine";
import type { GameView } from "@/lib/game/server";

type Stage = "boot" | "lobby" | "queue" | "game";

interface QueueStatus {
  queued: boolean;
  gameId: string | null;
}

type Message = GameView["messages"][number];

async function api<T>(url: string, init?: { method: string; body?: unknown }): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: init?.method,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function GameRoom() {
  const [stage, setStage] = useState<Stage>("boot");
  const [fast, setFast] = useState(false);
  const [gameId, setGameId] = useState<string | null>(null);
  const [view, setView] = useState<GameView | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);

  const cursor = useRef(0); // 지금까지 받은 메시지 수
  const endsAt = useRef(0);
  const clockSkew = useRef(0); // 서버 시간 - 내 시간
  const chatEndRef = useRef<HTMLDivElement>(null);

  const enterGame = useCallback((id: string) => {
    cursor.current = 0;
    setMessages([]);
    setView(null);
    setGameId(id);
    setStage("game");
  }, []);

  // 새로고침해도 대기 중이거나 진행 중인 게임으로 돌아온다
  useEffect(() => {
    let cancelled = false;
    api<QueueStatus>("/api/game/queue").then((status) => {
      if (cancelled) return;
      if (status?.gameId) enterGame(status.gameId);
      else setStage(status?.queued ? "queue" : "lobby");
    });
    return () => {
      cancelled = true;
    };
  }, [enterGame]);

  // 대기열: 폴링하면서 상대가 잡히면 게임에 입장
  useEffect(() => {
    if (stage !== "queue") return;
    const timer = setInterval(async () => {
      const status = await api<QueueStatus>("/api/game/queue");
      if (status?.gameId) enterGame(status.gameId);
      else if (status && !status.queued) setStage("lobby");
    }, 1500);
    return () => clearInterval(timer);
  }, [stage, enterGame]);

  const poll = useCallback(async () => {
    if (!gameId) return;
    const next = await api<GameView>(`/api/game/${gameId}?after=${cursor.current}`);
    if (!next) return;
    clockSkew.current = Date.parse(next.serverNow) - Date.now();
    endsAt.current = Date.parse(next.phaseEndsAt);
    cursor.current = Math.max(cursor.current, next.total);
    if (next.messages.length > 0) {
      setMessages((prev) => [...prev, ...next.messages.filter((m) => m.id >= prev.length)]);
    }
    setView(next);
  }, [gameId]);

  useEffect(() => {
    if (stage !== "game") return;
    poll();
    const pollTimer = setInterval(poll, 1000);
    const clockTimer = setInterval(() => {
      const left = Math.ceil((endsAt.current - (Date.now() + clockSkew.current)) / 1000);
      setSecondsLeft(Math.max(0, left));
    }, 250);
    return () => {
      clearInterval(pollTimer);
      clearInterval(clockTimer);
    };
  }, [stage, poll]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function startMatching() {
    setStage("queue");
    const status = await api<QueueStatus>("/api/game/queue", {
      method: "POST",
      body: { fast },
    });
    if (status?.gameId) enterGame(status.gameId);
  }

  async function cancelMatching() {
    await api("/api/game/queue", { method: "DELETE" });
    setStage("lobby");
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !gameId) return;
    setDraft("");
    await api(`/api/game/${gameId}/messages`, { method: "POST", body: { text } });
    poll();
  }

  async function castVote(targetId: string) {
    if (!gameId) return;
    setView((prev) => (prev ? { ...prev, myVote: targetId } : prev));
    await api(`/api/game/${gameId}/vote`, { method: "POST", body: { targetId } });
    poll();
  }

  if (stage === "boot") {
    return <main className="flex flex-1 items-center justify-center text-sm text-zinc-500">불러오는 중...</main>;
  }

  if (stage === "lobby") {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">Are You AI?</h1>
        <ul className="list-disc space-y-2 pl-5 text-zinc-600 dark:text-zinc-400">
          <li>
            게임 시작을 누른 플레이어 {HUMANS_PER_GAME}명이 모이면 방에 입장합니다. 방에는 AI가 1명 숨어
            있어 총 {PLAYER_COUNT}명이 됩니다.
          </li>
          <li>모두 랜덤한 이름을 받습니다.</li>
          <li>{formatTime(CHAT_SECONDS)}간 대화한 뒤 {VOTE_SECONDS}초 동안 비밀투표합니다.</li>
          <li>최다 득표자가 사람이면 탈락, AI면 플레이어의 승리입니다.</li>
          <li>동률이면 투표가 무효가 되고 다시 대화합니다.</li>
          <li>최종 2인에 AI가 남으면 AI의 승리입니다.</li>
        </ul>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} />
          빠른 테스트 (대화 {FAST_CHAT_SECONDS}초, 매칭된 두 명 모두 체크해야 적용)
        </label>
        <button
          onClick={startMatching}
          className="h-12 rounded-full bg-foreground font-medium text-background transition-opacity hover:opacity-90"
        >
          게임 시작
        </button>
        <Link href="/" className="text-center text-sm text-zinc-500 underline">
          홈으로
        </Link>
      </main>
    );
  }

  if (stage === "queue") {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 px-6">
        <p className="animate-pulse text-lg font-medium">상대 플레이어를 찾는 중...</p>
        <p className="text-center text-sm text-zinc-500">
          다른 플레이어가 게임 시작을 누르면 자동으로 입장합니다.
        </p>
        <button
          onClick={cancelMatching}
          className="h-11 rounded-full border border-black/10 px-6 text-sm dark:border-white/20"
        >
          취소
        </button>
      </main>
    );
  }

  if (!view) {
    return <main className="flex flex-1 items-center justify-center text-sm text-zinc-500">입장 중...</main>;
  }

  const { me, phase, result, winner } = view;
  const youAlive = !me.eliminated;
  const nameOf = (id: string | null) => view.participants.find((p) => p.id === id)?.name ?? "";
  const alive = view.participants.filter((p) => !p.eliminated);

  return (
    <main className="mx-auto flex h-dvh w-full max-w-2xl flex-col">
      <header className="border-b border-black/10 px-4 py-3 dark:border-white/15">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">
            {view.round}라운드 ·{" "}
            {phase === "chat" && "대화"}
            {phase === "vote" && "투표"}
            {phase === "result" && "결과"}
            {phase === "over" && "게임 종료"}
          </span>
          {phase !== "over" && (
            <span className="font-mono text-base tabular-nums">{formatTime(secondsLeft)}</span>
          )}
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          당신의 이름: <b>{me.name}</b>
          {!youAlive && " (탈락)"}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {view.participants.map((p) => (
            <span
              key={p.id}
              className={`rounded-full border px-3 py-1 text-xs ${
                p.eliminated
                  ? "border-transparent bg-zinc-200 text-zinc-400 line-through dark:bg-zinc-800"
                  : "border-black/10 dark:border-white/20"
              }`}
            >
              {p.name}
              {p.isYou && " (나)"}
              {p.isAI && " 🤖"}
            </span>
          ))}
        </div>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {messages.map((m) =>
          m.speakerId === null ? (
            <p key={m.id} className="py-1 text-center text-xs text-zinc-500">
              {m.text}
            </p>
          ) : (
            <div
              key={m.id}
              className={`flex flex-col ${m.speakerId === me.id ? "items-end" : "items-start"}`}
            >
              <span className="text-xs text-zinc-500">{nameOf(m.speakerId)}</span>
              <p
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  m.speakerId === me.id
                    ? "bg-foreground text-background"
                    : "bg-zinc-100 dark:bg-zinc-800"
                }`}
              >
                {m.text}
              </p>
            </div>
          ),
        )}
        <div ref={chatEndRef} />
      </div>

      <footer className="border-t border-black/10 p-4 dark:border-white/15">
        {phase === "chat" &&
          (youAlive ? (
            <form onSubmit={sendMessage} className="flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="메시지를 입력하세요"
                maxLength={200}
                className="h-11 min-w-0 flex-1 rounded-full border border-black/10 bg-transparent px-4 text-sm outline-none focus:border-foreground dark:border-white/20"
              />
              <button
                type="submit"
                className="h-11 rounded-full bg-foreground px-5 text-sm font-medium text-background"
              >
                전송
              </button>
            </form>
          ) : (
            <p className="text-center text-sm text-zinc-500">
              탈락하여 대화에 참여할 수 없습니다. 관전 중...
            </p>
          ))}

        {phase === "vote" &&
          (youAlive ? (
            <div>
              <p className="mb-2 text-center text-sm">누가 AI일까요? (비밀투표)</p>
              <div className="flex flex-wrap justify-center gap-2">
                {alive
                  .filter((p) => !p.isYou)
                  .map((p) => (
                    <button
                      key={p.id}
                      onClick={() => castVote(p.id)}
                      className={`h-11 rounded-full border px-5 text-sm ${
                        view.myVote === p.id
                          ? "border-foreground bg-foreground text-background"
                          : "border-black/10 dark:border-white/20"
                      }`}
                    >
                      {p.name}
                    </button>
                  ))}
              </div>
            </div>
          ) : (
            <p className="text-center text-sm text-zinc-500">
              탈락하여 투표할 수 없습니다. 결과를 기다리는 중...
            </p>
          ))}

        {phase === "result" && result && (
          <div className="space-y-3">
            <ul className="space-y-1 text-sm">
              {Object.entries(result.counts)
                .sort((a, b) => b[1] - a[1])
                .map(([id, count]) => (
                  <li key={id} className="flex justify-between">
                    <span>{nameOf(id)}</span>
                    <span className="tabular-nums">{count}표</span>
                  </li>
                ))}
            </ul>
            <p className="text-center text-sm font-medium">
              {result.outcome.kind === "tie" && "동률입니다. 투표가 무효되고 다시 대화를 시작합니다."}
              {result.outcome.kind === "eliminated" &&
                (result.outcome.targetId === me.id
                  ? "당신이 지목되어 탈락했습니다."
                  : `${nameOf(result.outcome.targetId)}님은 사람이었습니다. 탈락!`)}
              {result.outcome.kind === "ai-caught" &&
                `${nameOf(result.outcome.targetId)}님이 AI였습니다!`}
            </p>
            <p className="text-center text-xs text-zinc-500">
              {winner ? "곧 최종 결과가 표시됩니다." : "곧 다음 라운드가 시작됩니다."}
            </p>
          </div>
        )}

        {phase === "over" && (
          <div className="space-y-3 text-center">
            <p className="text-lg font-semibold">
              {winner === "players" ? "플레이어 승리! AI를 찾아냈습니다." : "AI 승리! 끝까지 들키지 않았습니다."}
            </p>
            <p className="text-sm text-zinc-500">
              AI는 {view.participants.find((p) => p.isAI)?.name}님이었습니다.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setStage("lobby")}
                className="h-11 flex-1 rounded-full bg-foreground text-sm font-medium text-background"
              >
                다시 하기
              </button>
              <Link
                href="/"
                className="flex h-11 flex-1 items-center justify-center rounded-full border border-black/10 text-sm dark:border-white/20"
              >
                홈으로
              </Link>
            </div>
          </div>
        )}
      </footer>
    </main>
  );
}
