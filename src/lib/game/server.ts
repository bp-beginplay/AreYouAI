import { ObjectId, type UpdateFilter } from "mongodb";
import { after } from "next/server";
import { getDb } from "@/lib/mongodb";
import {
  aiAvailable,
  generateChatLine,
  generateVoteTarget,
  AI_PERSONA,
  type AiContext,
} from "./ai";
import {
  CHAT_SECONDS,
  FAST_CHAT_SECONDS,
  VOTE_SECONDS,
  aliveOf,
  checkWinner,
  eliminate,
  pickAiLine,
  randomNames,
  resolveRound,
  shuffle,
  tally,
  type Participant,
  type RoundOutcome,
  type VoteCounts,
  type VoteMap,
  type Winner,
} from "./engine";

const QUEUE_STALE_MS = 10_000; // 이 시간 동안 폴링이 없으면 대기열에서 없는 사람으로 취급
const RESULT_SECONDS = 8;

type Phase = "chat" | "vote" | "result" | "over";

interface GameParticipant extends Participant {
  userId: string | null; // null = AI
}

interface GameDoc {
  _id: ObjectId;
  participants: GameParticipant[];
  round: number;
  phase: Phase;
  phaseEndsAt: Date;
  nextAiAt: Date;
  chatSeconds: number;
  votes: VoteMap;
  solo: boolean; // 테스트용 1대1 대화: AI는 투표하지 않고 사람의 투표만 집계한다
  aiPersona: string;
  aiLockUntil: Date | null; // AI 모델 호출 중복 방지용 잠금
  aiVote: { round: number; targetId: string } | null;
  messages: { speakerId: string | null; text: string }[];
  result: { outcome: RoundOutcome; counts: VoteCounts } | null;
  winner: Winner | null;
  version: number; // 상태 전이의 중복 적용을 막는 낙관적 락
  createdAt: Date;
}

interface QueueDoc {
  _id: string; // userId
  seenAt: Date;
  fast: boolean;
  gameId: ObjectId | null;
}

async function collections() {
  const db = await getDb();
  return {
    games: db.collection<GameDoc>("games"),
    queue: db.collection<QueueDoc>("queue"),
  };
}

// ---------- 매칭 ----------

function buildGame(userIds: string[], fast: boolean, solo = false): GameDoc {
  const names = randomNames(userIds.length + 1);
  const slots = shuffle<string | null>([...userIds, null]);
  const now = Date.now();
  const chatSeconds = fast ? FAST_CHAT_SECONDS : CHAT_SECONDS;
  return {
    _id: new ObjectId(),
    participants: slots.map((userId, i) => ({
      id: `p${i}`,
      name: names[i],
      isAI: userId === null,
      eliminated: false,
      userId,
    })),
    round: 1,
    phase: "chat",
    phaseEndsAt: new Date(now + chatSeconds * 1000),
    nextAiAt: new Date(now + 3000),
    chatSeconds,
    votes: {},
    solo,
    aiPersona: AI_PERSONA,
    aiLockUntil: null,
    aiVote: null,
    messages: [
      {
        speakerId: null,
        text: solo
          ? "테스트 1대1 대화입니다. AI와 자유롭게 대화해 보세요."
          : "1라운드 시작! 대화 속에 숨은 AI를 찾아보세요.",
      },
    ],
    result: null,
    winner: null,
    version: 0,
    createdAt: new Date(now),
  };
}

// 대기 중인 다른 플레이어가 있으면 함께 게임을 만들고 gameId를 반환한다
async function tryMatch(userId: string): Promise<string | null> {
  const { games, queue } = await collections();
  const cutoff = new Date(Date.now() - QUEUE_STALE_MS);

  const me = await queue.findOne({ _id: userId });
  if (!me) return null;
  if (me.gameId) return me.gameId.toString();

  const other = await queue.findOne({
    _id: { $ne: userId },
    gameId: null,
    seenAt: { $gt: cutoff },
  });
  if (!other) return null;

  const game = buildGame([userId, other._id], me.fast && other.fast);
  await games.insertOne(game);

  const claimedOther = await queue.updateOne(
    { _id: other._id, gameId: null, seenAt: { $gt: cutoff } },
    { $set: { gameId: game._id } },
  );
  if (claimedOther.matchedCount === 0) {
    await games.deleteOne({ _id: game._id });
    return null;
  }

  const claimedMe = await queue.updateOne(
    { _id: userId, gameId: null },
    { $set: { gameId: game._id } },
  );
  if (claimedMe.matchedCount === 0) {
    // 동시에 다른 사람에게 먼저 매칭됨: 상대를 되돌리고 내 게임을 따른다
    await queue.updateOne({ _id: other._id, gameId: game._id }, { $set: { gameId: null } });
    await games.deleteOne({ _id: game._id });
    const refreshed = await queue.findOne({ _id: userId });
    return refreshed?.gameId?.toString() ?? null;
  }
  return game._id.toString();
}

export async function enqueue(userId: string, fast: boolean) {
  const { queue } = await collections();
  await queue.updateOne(
    { _id: userId },
    { $set: { seenAt: new Date(), fast, gameId: null } },
    { upsert: true },
  );
  return queueStatus(userId);
}

// 폴링할 때마다 대기 상태를 갱신하고, 상대가 있으면 매칭한다
export async function queueStatus(userId: string) {
  const { games, queue } = await collections();
  const entry = await queue.findOneAndUpdate(
    { _id: userId },
    { $set: { seenAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!entry) return { queued: false, gameId: null };

  const gameId = entry.gameId?.toString() ?? (await tryMatch(userId));
  if (!gameId) return { queued: true, gameId: null };

  // 끝난 게임이면 대기도 진행도 아닌 상태 (로비)
  const game = await games.findOne({ _id: new ObjectId(gameId) }, { projection: { phase: 1 } });
  if (!game || game.phase === "over") return { queued: false, gameId: null };
  return { queued: false, gameId };
}

// 테스트용: 대기 없이 AI와 1대1 게임을 바로 만든다. 대기열 문서에 연결해 새로고침해도 복귀한다
export async function startSoloGame(userId: string, fast: boolean) {
  const { games, queue } = await collections();
  const game = buildGame([userId], fast, true);
  await games.insertOne(game);
  await queue.updateOne(
    { _id: userId },
    { $set: { seenAt: new Date(), fast, gameId: game._id } },
    { upsert: true },
  );
  return { queued: false, gameId: game._id.toString() };
}

export async function cancelQueue(userId: string) {
  const { queue } = await collections();
  await queue.deleteOne({ _id: userId, gameId: null });
}

// ---------- 게임 진행 (폴링 시점에 시간이 지난 전이를 적용) ----------

function nextUpdate(game: GameDoc, now: Date): UpdateFilter<GameDoc> | null {
  const t = now.getTime();
  const ai = game.participants.find((p) => p.isAI)!;

  if (game.phase === "chat") {
    if (t >= game.phaseEndsAt.getTime()) {
      return {
        $set: { phase: "vote", phaseEndsAt: new Date(t + VOTE_SECONDS * 1000), votes: {} },
        $push: { messages: { speakerId: null, text: "투표 시간입니다. 누가 AI일까요?" } },
      };
    }
    return null; // AI의 발언은 maybeStartAi가 모델을 호출해서 처리한다
  }

  if (game.phase === "vote") {
    const aliveHumans = aliveOf(game.participants).filter((p) => !p.isAI);
    const allVoted = aliveHumans.every((p) => p.id in game.votes);
    const aiVoted = ai.eliminated || game.solo || game.aiVote?.round === game.round;
    if (t < game.phaseEndsAt.getTime() && !(allVoted && aiVoted)) return null;

    const alive = aliveOf(game.participants);
    const votes: VoteMap = { ...game.votes };
    if (!ai.eliminated && !game.solo) {
      const candidates = alive.filter((p) => p.id !== ai.id);
      const decided =
        game.aiVote?.round === game.round
          ? candidates.find((p) => p.id === game.aiVote!.targetId)
          : undefined;
      // 모델이 제때 정하지 못했으면 무작위
      votes[ai.id] = (decided ?? candidates[Math.floor(Math.random() * candidates.length)]).id;
    }
    const counts = tally(votes, game.participants);
    const outcome = resolveRound(counts, game.participants);
    const next =
      outcome.kind === "tie" ? game.participants : eliminate(game.participants, outcome.targetId);
    const winner = outcome.kind === "ai-caught" ? "players" : checkWinner(next);
    const nameOf = (id: string) => game.participants.find((p) => p.id === id)!.name;
    const text =
      outcome.kind === "tie"
        ? "동률! 투표가 무효 처리되었습니다."
        : `${nameOf(outcome.targetId)}님이 최다 득표로 지목되었습니다.`;

    return {
      $set: {
        participants: next as GameParticipant[],
        votes,
        result: { outcome, counts },
        winner,
        phase: "result",
        phaseEndsAt: new Date(t + RESULT_SECONDS * 1000),
      },
      $push: { messages: { speakerId: null, text } },
    };
  }

  if (game.phase === "result") {
    if (t < game.phaseEndsAt.getTime()) return null;
    if (game.winner) return { $set: { phase: "over" } };
    return {
      $set: {
        phase: "chat",
        round: game.round + 1,
        phaseEndsAt: new Date(t + game.chatSeconds * 1000),
        nextAiAt: new Date(t + 2000),
        votes: {},
      },
      $push: { messages: { speakerId: null, text: `${game.round + 1}라운드 대화를 시작합니다.` } },
    };
  }

  return null;
}

function aiContext(game: GameDoc, ai: GameParticipant): AiContext {
  const nameOf = (id: string | null) => game.participants.find((p) => p.id === id)?.name ?? "";
  const transcript = game.messages
    .slice(-30)
    .map((m) => (m.speakerId === null ? `(안내) ${m.text}` : `${nameOf(m.speakerId)}: ${m.text}`))
    .join("\n");
  return {
    aiName: ai.name,
    persona: game.aiPersona,
    humanCount: game.participants.filter((p) => !p.isAI).length,
    transcript,
  };
}

// AI가 말하거나 투표할 차례면 응답이 끝난 뒤(after) 모델을 호출한다.
// 잠금을 먼저 잡아 폴링이 겹쳐도 한 번만 호출한다. 실패하면 스크립트 대사/무작위 투표로 대체한다.
async function maybeStartAi(game: GameDoc) {
  const ai = game.participants.find((p) => p.isAI)!;
  if (ai.eliminated || game.winner) return;
  const now = new Date();
  const kind =
    game.phase === "chat" && now >= game.nextAiAt
      ? "chat"
      : game.phase === "vote" && !game.solo && game.aiVote?.round !== game.round
        ? "vote"
        : null;
  if (!kind) return;

  const { games } = await collections();
  const claimed = await games.updateOne(
    { _id: game._id, $or: [{ aiLockUntil: null }, { aiLockUntil: { $lte: now } }] },
    { $set: { aiLockUntil: new Date(now.getTime() + 20_000) } },
  );
  if (claimed.matchedCount === 0) return;

  after(async () => {
    try {
      const ctx = aiContext(game, ai);
      if (kind === "chat") {
        let text: string | null;
        try {
          if (!aiAvailable()) throw new Error("ANTHROPIC_API_KEY is not set");
          text = await generateChatLine(ctx);
        } catch (error) {
          console.error("[ai] chat fallback:", error);
          text = pickAiLine(
            new Set(game.messages.filter((m) => m.speakerId === ai.id).map((m) => m.text)),
          );
        }
        if (text) {
          await games.updateOne(
            { _id: game._id, phase: "chat", round: game.round },
            { $push: { messages: { speakerId: ai.id, text } } },
          );
        }
        const delay = text ? 3000 + Math.random() * 5000 : 4000;
        await games.updateOne({ _id: game._id }, { $set: { nextAiAt: new Date(Date.now() + delay) } });
      } else {
        const candidates = aliveOf(game.participants).filter((p) => p.id !== ai.id);
        let target = candidates[Math.floor(Math.random() * candidates.length)];
        try {
          if (!aiAvailable()) throw new Error("ANTHROPIC_API_KEY is not set");
          const name = await generateVoteTarget(ctx, candidates.map((p) => p.name));
          target = candidates.find((p) => p.name === name) ?? target;
        } catch (error) {
          console.error("[ai] vote fallback:", error);
        }
        await games.updateOne(
          { _id: game._id, phase: "vote", round: game.round },
          { $set: { aiVote: { round: game.round, targetId: target.id } } },
        );
      }
    } catch (error) {
      console.error("[ai] failed:", error);
    } finally {
      await games.updateOne({ _id: game._id }, { $set: { aiLockUntil: null } });
    }
  });
}

async function advance(gameId: ObjectId): Promise<GameDoc | null> {
  const { games } = await collections();
  for (let i = 0; i < 8; i++) {
    const game = await games.findOne({ _id: gameId });
    if (!game) return null;
    const update = nextUpdate(game, new Date());
    if (!update) {
      await maybeStartAi(game);
      return game;
    }
    // 다른 요청이 먼저 전이했으면 version이 달라 적용되지 않고 다시 읽는다
    await games.updateOne(
      { _id: gameId, version: game.version },
      { ...update, $inc: { version: 1 } },
    );
  }
  return games.findOne({ _id: gameId });
}

function toObjectId(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

export async function getGameView(id: string, userId: string, after: number) {
  const oid = toObjectId(id);
  if (!oid) return null;
  const game = await advance(oid);
  const me = game?.participants.find((p) => p.userId === userId);
  if (!game || !me) return null;

  const over = game.phase === "over";
  return {
    id: game._id.toString(),
    round: game.round,
    phase: game.phase,
    phaseEndsAt: game.phaseEndsAt.toISOString(),
    serverNow: new Date().toISOString(),
    me: { id: me.id, name: me.name, eliminated: me.eliminated },
    participants: game.participants.map((p) => ({
      id: p.id,
      name: p.name,
      eliminated: p.eliminated,
      isYou: p.id === me.id,
      isAI: over ? p.isAI : undefined, // 게임이 끝나기 전에는 숨긴다
    })),
    messages: game.messages
      .slice(after)
      .map((m, i) => ({ id: after + i, speakerId: m.speakerId, text: m.text })),
    total: game.messages.length,
    myVote: game.votes[me.id] ?? null,
    result: game.phase === "result" || over ? game.result : null,
    winner: game.phase === "result" || over ? game.winner : null,
  };
}

export type GameView = NonNullable<Awaited<ReturnType<typeof getGameView>>>;

export async function postMessage(id: string, userId: string, text: string) {
  const oid = toObjectId(id);
  const body = text.trim().slice(0, 200);
  if (!oid || !body) return false;
  const game = await advance(oid);
  const me = game?.participants.find((p) => p.userId === userId);
  if (!game || !me || me.eliminated || game.phase !== "chat") return false;

  const { games } = await collections();
  const res = await games.updateOne(
    { _id: oid, phase: "chat" },
    { $push: { messages: { speakerId: me.id, text: body } } },
  );
  return res.matchedCount === 1;
}

export async function postVote(id: string, userId: string, targetId: string) {
  const oid = toObjectId(id);
  if (!oid) return false;
  const game = await advance(oid);
  const me = game?.participants.find((p) => p.userId === userId);
  if (!game || !me || me.eliminated || game.phase !== "vote") return false;
  const target = aliveOf(game.participants).find((p) => p.id === targetId);
  if (!target || target.id === me.id) return false;

  const { games } = await collections();
  const res = await games.updateOne(
    { _id: oid, phase: "vote" },
    { $set: { [`votes.${me.id}`]: target.id } },
  );
  if (res.matchedCount !== 1) return false;
  await advance(oid); // 모두 투표했으면 바로 집계
  return true;
}
