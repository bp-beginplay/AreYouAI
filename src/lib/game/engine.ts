export const HUMANS_PER_GAME = 2;
export const PLAYER_COUNT = HUMANS_PER_GAME + 1; // 사람 + AI 1명
export const CHAT_SECONDS = 300;
export const FAST_CHAT_SECONDS = 30;
export const VOTE_SECONDS = 10;

export interface Participant {
  id: string;
  name: string;
  isAI: boolean;
  eliminated: boolean;
}

// voterId -> targetId (null = 기권)
export type VoteMap = Record<string, string | null>;
export type VoteCounts = Record<string, number>;

export type RoundOutcome =
  | { kind: "tie" }
  | { kind: "eliminated"; targetId: string }
  | { kind: "ai-caught"; targetId: string };

export type Winner = "ai" | "players";

const NAME_POOL = [
  "하늘", "바다", "민트", "루나", "도토리", "보리", "구름", "나무",
  "별이", "호두", "모래", "솜이", "라떼", "여름", "새벽", "단풍",
];

const AI_LINES = [
  "안녕하세요, 반갑습니다. 잘 부탁드려요.",
  "저는 평소에 이런 게임을 즐겨 하는 편이에요.",
  "다들 어떤 기준으로 의심하고 계신가요?",
  "오늘 하루는 어떻게 보내셨나요?",
  "개인적으로는 대화의 자연스러움이 중요하다고 생각해요.",
  "저는 아니에요. 함께 찾아봅시다.",
  "취미가 무엇인지 궁금하네요.",
  "조금 긴장되지만 재미있을 것 같아요.",
  "말투만으로 판단하기는 어려울 것 같아요.",
  "저는 음악 듣는 걸 좋아해요. 여러분은요?",
  "서로 질문을 주고받으면 도움이 될 거예요.",
  "잠깐 생각할 시간이 필요하네요.",
];

export function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function randomNames(count: number): string[] {
  return shuffle(NAME_POOL).slice(0, count);
}

export function aliveOf(participants: Participant[]): Participant[] {
  return participants.filter((p) => !p.eliminated);
}

export function tally(votes: VoteMap, participants: Participant[]): VoteCounts {
  const counts: VoteCounts = {};
  for (const p of aliveOf(participants)) counts[p.id] = 0;
  for (const target of Object.values(votes)) {
    if (target !== null && target in counts) counts[target] += 1;
  }
  return counts;
}

// 최다 득표가 단독이 아니면 동률(투표 무효)
export function resolveRound(
  counts: VoteCounts,
  participants: Participant[],
): RoundOutcome {
  const max = Math.max(...Object.values(counts));
  const top = Object.keys(counts).filter((id) => counts[id] === max);
  if (top.length !== 1) return { kind: "tie" };
  const target = participants.find((p) => p.id === top[0])!;
  return { kind: target.isAI ? "ai-caught" : "eliminated", targetId: target.id };
}

export function eliminate(participants: Participant[], targetId: string): Participant[] {
  return participants.map((p) => (p.id === targetId ? { ...p, eliminated: true } : p));
}

// AI가 잡히면 플레이어 승리, 최종 2인에 AI가 남으면 AI 승리
export function checkWinner(participants: Participant[]): Winner | null {
  const alive = aliveOf(participants);
  if (!alive.some((p) => p.isAI)) return "players";
  if (alive.length <= 2) return "ai";
  return null;
}

// AI의 대사 (프로토타입: 미리 정해둔 문장). used에 있는 대사는 피하고, 모두 썼으면 다시 쓴다
export function pickAiLine(used: Set<string>): string {
  const fresh = AI_LINES.filter((line) => !used.has(line));
  const candidates = fresh.length > 0 ? fresh : AI_LINES;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
