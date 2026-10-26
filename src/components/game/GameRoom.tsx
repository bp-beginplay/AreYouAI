"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHAT_SECONDS,
  FAST_CHAT_SECONDS,
  VOTE_SECONDS,
  aliveOf,
  botVotes,
  checkWinner,
  createParticipants,
  eliminate,
  pickLine,
  resolveRound,
  tally,
  type Participant,
  type RoundOutcome,
  type VoteCounts,
  type Winner,
} from "@/lib/game/engine";

type Phase = "lobby" | "chat" | "vote" | "result" | "over";

interface Message {
  id: number;
  speakerId: string | null; // null = 시스템 메시지
  text: string;
}

interface RoundResult {
  outcome: RoundOutcome;
  counts: VoteCounts;
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function GameRoom() {
  const [phase, setPhase] = useState<Phase>("lobby");
  const [fast, setFast] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [round, setRound] = useState(1);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [myVote, setMyVote] = useState<string | null>(null);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [winner, setWinner] = useState<Winner | null>(null);

  const nextMessageId = useRef(0);
  const usedLines = useRef(new Map<string, Set<string>>());
  const tickRef = useRef<() => void>(() => {});
  const chatEndRef = useRef<HTMLDivElement>(null);

  const chatSeconds = fast ? FAST_CHAT_SECONDS : CHAT_SECONDS;
  const you = participants.find((p) => p.isYou);
  const youAlive = !!you && !you.eliminated;
  const nameOf = (id: string | null) =>
    participants.find((p) => p.id === id)?.name ?? "";

  const addMessage = useCallback((speakerId: string | null, text: string) => {
    nextMessageId.current += 1;
    const id = nextMessageId.current;
    setMessages((prev) => [...prev, { id, speakerId, text }]);
  }, []);

  function startGame() {
    usedLines.current = new Map();
    setParticipants(createParticipants());
    setRound(1);
    setMessages([]);
    setMyVote(null);
    setResult(null);
    setWinner(null);
    addMessage(null, "1라운드 시작! 대화 속에 숨은 AI를 찾아보세요.");
    setPhase("chat");
    setSecondsLeft(chatSeconds);
  }

  function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !you || !youAlive) return;
    addMessage(you.id, text);
    setDraft("");
  }

  function finishVote() {
    const votes = { ...botVotes(participants) };
    if (you && youAlive) votes[you.id] = myVote;

    const counts = tally(votes, participants);
    const outcome = resolveRound(counts, participants);

    let next = participants;
    if (outcome.kind !== "tie") next = eliminate(participants, outcome.targetId);

    if (outcome.kind === "tie") {
      addMessage(null, "동률! 투표가 무효 처리되었습니다.");
    } else {
      addMessage(null, `${nameOf(outcome.targetId)}님이 최다 득표로 지목되었습니다.`);
    }

    setParticipants(next);
    setResult({ outcome, counts });
    setWinner(outcome.kind === "ai-caught" ? "players" : checkWinner(next));
    setPhase("result");
  }

  function advance() {
    if (phase === "chat") {
      setPhase("vote");
      setSecondsLeft(VOTE_SECONDS);
      setMyVote(null);
    } else if (phase === "vote") {
      finishVote();
    }
  }

  function continueGame() {
    if (winner) {
      setPhase("over");
      return;
    }
    setRound(round + 1);
    addMessage(null, `${round + 1}라운드 대화를 시작합니다.`);
    setPhase("chat");
    setSecondsLeft(chatSeconds);
  }

  // 매 렌더마다 최신 상태를 보는 틱 핸들러를 갱신
  useEffect(() => {
    tickRef.current = () => {
      if (secondsLeft > 1) setSecondsLeft(secondsLeft - 1);
      else advance();
    };
  });

  useEffect(() => {
    if (phase !== "chat" && phase !== "vote") return;
    const id = setInterval(() => tickRef.current(), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // 생존한 봇이 2~6초 간격으로 대사를 친다 (프로토타입용 스크립트)
  useEffect(() => {
    if (phase !== "chat") return;
    const speakers = participants.filter((p) => !p.isYou && !p.eliminated);
    if (speakers.length === 0) return;

    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        const speaker = speakers[Math.floor(Math.random() * speakers.length)];
        const used = usedLines.current.get(speaker.id) ?? new Set<string>();
        usedLines.current.set(speaker.id, used);
        addMessage(speaker.id, pickLine(speaker.isAI, used));
        schedule();
      }, 2000 + Math.random() * 4000);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [phase, participants, addMessage]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (phase === "lobby") {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">Are You AI?</h1>
        <ul className="list-disc space-y-2 pl-5 text-zinc-600 dark:text-zinc-400">
          <li>5명 중 1명은 AI입니다. 모두 랜덤한 이름을 받습니다.</li>
          <li>{formatTime(CHAT_SECONDS)}간 대화한 뒤 {VOTE_SECONDS}초 동안 비밀투표합니다.</li>
          <li>최다 득표자가 사람이면 탈락, AI면 플레이어의 승리입니다.</li>
          <li>동률이면 투표가 무효가 되고 다시 대화합니다.</li>
          <li>최종 2인에 AI가 남으면 AI의 승리입니다.</li>
        </ul>
        <p className="rounded-lg bg-zinc-100 p-3 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          프로토타입: 나를 제외한 4명은 미리 정해둔 대사를 말하는 봇입니다.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={fast}
            onChange={(e) => setFast(e.target.checked)}
          />
          빠른 테스트 (대화 {FAST_CHAT_SECONDS}초)
        </label>
        <button
          onClick={startGame}
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

  const alive = aliveOf(participants);

  return (
    <main className="mx-auto flex h-dvh w-full max-w-2xl flex-col">
      <header className="border-b border-black/10 px-4 py-3 dark:border-white/15">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">
            {round}라운드 ·{" "}
            {phase === "chat" && "대화"}
            {phase === "vote" && "투표"}
            {phase === "result" && "결과"}
            {phase === "over" && "게임 종료"}
          </span>
          {(phase === "chat" || phase === "vote") && (
            <span className="font-mono text-base tabular-nums">{formatTime(secondsLeft)}</span>
          )}
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          당신의 이름: <b>{you?.name}</b>
          {!youAlive && " (탈락)"}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {participants.map((p) => (
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
              {phase === "over" && p.isAI && " 🤖"}
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
              className={`flex flex-col ${m.speakerId === you?.id ? "items-end" : "items-start"}`}
            >
              <span className="text-xs text-zinc-500">{nameOf(m.speakerId)}</span>
              <p
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  m.speakerId === you?.id
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
                      onClick={() => setMyVote(p.id)}
                      className={`h-11 rounded-full border px-5 text-sm ${
                        myVote === p.id
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
                `${nameOf(result.outcome.targetId)}님은 사람이었습니다. 탈락!`}
              {result.outcome.kind === "ai-caught" &&
                `${nameOf(result.outcome.targetId)}님이 AI였습니다!`}
            </p>
            <button
              onClick={continueGame}
              className="h-11 w-full rounded-full bg-foreground text-sm font-medium text-background"
            >
              {winner ? "결과 보기" : "다음 라운드"}
            </button>
          </div>
        )}

        {phase === "over" && (
          <div className="space-y-3 text-center">
            <p className="text-lg font-semibold">
              {winner === "players" ? "플레이어 승리! AI를 찾아냈습니다." : "AI 승리! 끝까지 들키지 않았습니다."}
            </p>
            <p className="text-sm text-zinc-500">
              AI는 {participants.find((p) => p.isAI)?.name}님이었습니다.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPhase("lobby")}
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
