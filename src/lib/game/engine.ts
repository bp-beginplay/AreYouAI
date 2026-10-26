export const PLAYER_COUNT = 5;
export const CHAT_SECONDS = 300;
export const FAST_CHAT_SECONDS = 30;
export const VOTE_SECONDS = 10;

export interface Participant {
  id: string;
  name: string;
  isYou: boolean;
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

const HUMAN_LINES = [
  "안녕하세요~ 다들 처음이세요?",
  "오늘 날씨 진짜 좋네요",
  "ㅋㅋㅋ 이거 누가 AI인지 감도 안 잡히네",
  "저는 점심 먹고 바로 들어왔어요",
  "다들 주말에 뭐 하셨어요?",
  "아 긴장되네요 ㅎㅎ",
  "방금 말투 좀 수상한데...",
  "저 아닙니다 진짜로",
  "커피 한 잔 하면서 하는 중이에요",
  "ㅋㅋ 질문 하나씩 해볼까요?",
  "좋아하는 음식이 뭐예요?",
  "으아 5분 너무 짧다",
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

// 나 1명 + 사람 역할 봇 3명 + AI 1명, 이름은 모두 랜덤
export function createParticipants(): Participant[] {
  const names = shuffle(NAME_POOL).slice(0, PLAYER_COUNT);
  const roles = shuffle([
    { isYou: true, isAI: false },
    { isYou: false, isAI: false },
    { isYou: false, isAI: false },
    { isYou: false, isAI: false },
    { isYou: false, isAI: true },
  ]);
  return roles.map((role, i) => ({
    id: `p${i}`,
    name: names[i],
    eliminated: false,
    ...role,
  }));
}

export function aliveOf(participants: Participant[]): Participant[] {
  return participants.filter((p) => !p.eliminated);
}

// 내가 아닌 생존자는 자기 자신을 제외한 생존자 중 한 명에게 투표한다
export function botVotes(participants: Participant[]): VoteMap {
  const alive = aliveOf(participants);
  const votes: VoteMap = {};
  for (const voter of alive) {
    if (voter.isYou) continue;
    const candidates = alive.filter((p) => p.id !== voter.id);
    votes[voter.id] = candidates[Math.floor(Math.random() * candidates.length)].id;
  }
  return votes;
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

// used: 이미 쓴 대사 (소진되면 초기화)
export function pickLine(isAI: boolean, used: Set<string>): string {
  const pool = isAI ? AI_LINES : HUMAN_LINES;
  let candidates = pool.filter((line) => !used.has(line));
  if (candidates.length === 0) {
    used.clear();
    candidates = pool;
  }
  const line = candidates[Math.floor(Math.random() * candidates.length)];
  used.add(line);
  return line;
}
