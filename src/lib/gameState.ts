import {
  fetchUsers,
  resolveWagerMatchOnChain,
  resolveRoyaleRoundOnChain,
  startRoyaleEntriesOnChain,
  payRoyaleChampionOnChain,
  type MatchOutcome,
  type OnChainUser,
} from "./bithumansActions";
import { pickRandomQuestion, type Question } from "./questionPool";

const NO_ANSWER = 255;
const ANSWER_TIMEOUT_MS = 15_000;
const NEVER_ANSWERED_MS = 0xffffffff; // uint32 max — can never win a speed tiebreak
const MAX_REASK_ROUNDS = 3; // both-wrong re-asks a fresh question, up to this many times

export interface PendingMatch {
  id: string;
  mode: "queue" | "royale";
  idA: string;
  nameA: string;
  idB: string;
  nameB: string;
  question: Question;
  answerA: number | null;
  answerB: number | null;
  /** Wall-clock time each side's answer was received, for the speed tiebreak — this is
   *  what actually decides a correctness tie now, not anything chain-random. */
  answeredAtA: number | null;
  answeredAtB: number | null;
  createdAt: number;
  /** Bumped each time both players answer wrong and get a fresh question instead of a
   *  speed tiebreak. Capped by MAX_REASK_ROUNDS so a match always eventually settles. */
  round: number;
  /** True once resolution (success or failure) has fully finished — only at that point
   *  is `outcome` guaranteed to be populated (if it's going to be). Distinct from the
   *  in-flight `resolving` flag so waitForMatch() never observes a false-done state
   *  while the on-chain write is still pending. */
  resolved: boolean;
  resolving: boolean;
  outcome?:
    | MatchOutcome
    | { winnerId: string; loserId: string; decidedByAnswer: boolean; winnerAnswerMs: number; loserAnswerMs: number };
}

export interface FeedEntry {
  winnerId: string;
  loserId: string;
  winnerName: string;
  loserName: string;
  questionId: number;
  decidedByAnswer: boolean;
  winnerAnswerMs: number;
  loserAnswerMs: number;
  wager: number;
  winnerBalanceAfter: number;
  loserBalanceAfter: number;
  txHash: string;
  explorerUrl: string;
  at: number;
  mode: "queue" | "royale";
}

interface RoyaleMatch {
  aId: string;
  bId: string | null;
  aName: string;
  bName: string | null;
  matchId: string | null;
  result: { winnerName: string; loserName: string; decidedByAnswer: boolean } | null;
}

interface RoyaleState {
  status: "idle" | "running" | "done";
  rounds: RoyaleMatch[][];
  currentRound: number;
  championId: string | null;
  championName: string | null;
  potAmount: number;
  startedAt: number | null;
}

interface GameState {
  queue: { userId: string; name: string; joinedAt: number }[];
  pendingMatches: Map<string, PendingMatch>;
  feed: FeedEntry[];
  royale: RoyaleState;
  matchmakerStarted: boolean;
}

const g = globalThis as unknown as { __bithumansState?: GameState };

function initState(): GameState {
  return {
    queue: [],
    pendingMatches: new Map(),
    feed: [],
    royale: { status: "idle", rounds: [], currentRound: 0, championId: null, championName: null, potAmount: 0, startedAt: null },
    matchmakerStarted: false,
  };
}

export const state: GameState = g.__bithumansState ?? (g.__bithumansState = initState());

function pushFeed(entry: FeedEntry) {
  state.feed.unshift(entry);
  state.feed = state.feed.slice(0, 30);
}

function createPendingMatch(idA: string, nameA: string, idB: string, nameB: string, mode: "queue" | "royale"): PendingMatch {
  const m: PendingMatch = {
    id: `${idA}-${idB}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    mode,
    idA,
    nameA,
    idB,
    nameB,
    question: pickRandomQuestion(),
    answerA: null,
    answerB: null,
    answeredAtA: null,
    answeredAtB: null,
    createdAt: Date.now(),
    round: 1,
    resolved: false,
    resolving: false,
  };
  state.pendingMatches.set(m.id, m);
  return m;
}

/** Returns the user's current match whether or not it's resolved yet — callers that
 *  need to display a live result (not just detect an active match) rely on this
 *  still finding it for a while after resolution (see the sweep timeout below). */
export function getPendingMatchForUser(userId: string): PendingMatch | undefined {
  for (const m of state.pendingMatches.values()) {
    if (m.idA === userId || m.idB === userId) return m;
  }
  return undefined;
}

function hasActivePendingMatch(userId: string): boolean {
  for (const m of state.pendingMatches.values()) {
    if (!m.resolved && (m.idA === userId || m.idB === userId)) return true;
  }
  return false;
}

export function getPendingMatch(matchId: string): PendingMatch | undefined {
  return state.pendingMatches.get(matchId);
}

/** Clears a resolved match immediately once the player has seen the result, so it can
 *  never resurface as a stale "match" the next time they queue up. */
export function dismissMatch(matchId: string) {
  const m = state.pendingMatches.get(matchId);
  if (m?.resolved) state.pendingMatches.delete(matchId);
}

async function resolveMatch(m: PendingMatch) {
  if (m.resolved || m.resolving) return;

  // Both sides genuinely answered (not timeout-substituted) and both were wrong: ask a
  // fresh question instead of falling back to a speed tiebreak. Capped by
  // MAX_REASK_ROUNDS so an unlucky pair can't stall a match forever.
  const bothReallyAnswered = m.answerA !== null && m.answerB !== null;
  if (bothReallyAnswered) {
    const aCorrect = m.answerA === m.question.correctIndex;
    const bCorrect = m.answerB === m.question.correctIndex;
    if (!aCorrect && !bCorrect && m.round < MAX_REASK_ROUNDS) {
      m.question = pickRandomQuestion();
      m.answerA = null;
      m.answerB = null;
      m.answeredAtA = null;
      m.answeredAtB = null;
      m.createdAt = Date.now();
      m.round += 1;
      return;
    }
  }

  m.resolving = true; // synchronous guard against a duplicate concurrent trigger
  const answerA = m.answerA ?? NO_ANSWER;
  const answerB = m.answerB ?? NO_ANSWER;
  const answerMsA = m.answeredAtA !== null ? m.answeredAtA - m.createdAt : NEVER_ANSWERED_MS;
  const answerMsB = m.answeredAtB !== null ? m.answeredAtB - m.createdAt : NEVER_ANSWERED_MS;

  try {
    if (m.mode === "queue") {
      const outcome = await resolveWagerMatchOnChain(
        m.idA,
        m.idB,
        m.question.id,
        m.question.correctIndex,
        answerA,
        answerB,
        answerMsA,
        answerMsB
      );
      m.outcome = outcome;
      pushFeed({
        winnerId: outcome.winnerId,
        loserId: outcome.loserId,
        winnerName: outcome.winnerId === m.idA ? m.nameA : m.nameB,
        loserName: outcome.loserId === m.idA ? m.nameA : m.nameB,
        questionId: outcome.questionId,
        decidedByAnswer: outcome.decidedByAnswer,
        winnerAnswerMs: outcome.winnerAnswerMs,
        loserAnswerMs: outcome.loserAnswerMs,
        wager: outcome.wager,
        winnerBalanceAfter: outcome.winnerBalanceAfter,
        loserBalanceAfter: outcome.loserBalanceAfter,
        txHash: outcome.txHash,
        explorerUrl: outcome.explorerUrl,
        at: Date.now(),
        mode: "queue",
      });
    } else {
      const outcome = await resolveRoyaleRoundOnChain(
        m.idA,
        m.idB,
        m.question.id,
        m.question.correctIndex,
        answerA,
        answerB,
        answerMsA,
        answerMsB
      );
      m.outcome = outcome;
    }
  } catch (err) {
    console.error("match resolution failed", err);
    // leave m.outcome unset; callers treat a missing outcome as a washout (nobody
    // advances / no feed entry) rather than hanging forever.
  } finally {
    // Only now is it safe for waitForMatch()/getPendingMatchForUser() callers to treat
    // this match as done — m.outcome (if any) is guaranteed populated by this point.
    m.resolved = true;
  }
}

export function submitAnswer(matchId: string, userId: string, choice: number) {
  const m = state.pendingMatches.get(matchId);
  if (!m || m.resolved) return;
  const now = Date.now();
  if (m.idA === userId && m.answerA === null) {
    m.answerA = choice;
    m.answeredAtA = now;
  } else if (m.idB === userId && m.answerB === null) {
    m.answerB = choice;
    m.answeredAtB = now;
  }
  if (m.answerA !== null && m.answerB !== null) {
    void resolveMatch(m);
  }
}

const QUEUE_STALE_MS = 90_000;

export function joinQueue(userId: string, name: string) {
  if (state.queue.some((q) => q.userId === userId)) return;
  if (hasActivePendingMatch(userId)) return;
  state.queue.push({ userId, name, joinedAt: Date.now() });
}

export function leaveQueue(userId: string) {
  state.queue = state.queue.filter((q) => q.userId !== userId);
}

export function queueSnapshot() {
  return state.queue;
}

let matchmakerTimer: ReturnType<typeof setInterval> | null = null;

export function startMatchmaker() {
  if (state.matchmakerStarted) return;
  state.matchmakerStarted = true;

  matchmakerTimer = setInterval(() => {
    // Force-resolve any pending match nobody has fully answered in time, so a stalled
    // or abandoned match never blocks the people waiting on it.
    const now = Date.now();
    for (const m of state.pendingMatches.values()) {
      if (!m.resolved && now - m.createdAt > ANSWER_TIMEOUT_MS) {
        void resolveMatch(m);
      }
    }
    // Sweep resolved matches out after a bit so getPendingMatch* stays small.
    for (const [id, m] of state.pendingMatches) {
      if (m.resolved && now - m.createdAt > ANSWER_TIMEOUT_MS * 4) {
        state.pendingMatches.delete(id);
      }
    }

    const cutoff = now - QUEUE_STALE_MS;
    state.queue = state.queue.filter((q) => q.joinedAt > cutoff);

    while (state.queue.length >= 2) {
      const a = state.queue.shift()!;
      const b = state.queue.shift()!;
      createPendingMatch(a.userId, a.name, b.userId, b.name, "queue");
    }
  }, 2000);
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildRound(participants: { id: string; name: string }[]): RoyaleMatch[] {
  const shuffled = shuffle(participants);
  const round: RoyaleMatch[] = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    const a = shuffled[i];
    const b = shuffled[i + 1];
    round.push({ aId: a.id, bId: b ? b.id : null, aName: a.name, bName: b ? b.name : null, matchId: null, result: null });
  }
  return round;
}

export function royaleSnapshot() {
  return state.royale;
}

export async function startRoyale(users: OnChainUser[]) {
  if (users.length < 2) throw new Error("need at least 2 players for a royale");
  if (state.royale.status === "running") throw new Error("a royale is already running");

  // The answer-timeout sweep (which force-resolves a royale round if someone doesn't
  // answer in time) lives on the same interval as the casual matchmaker — make sure
  // it's actually running even if nobody has ever joined the casual queue yet.
  startMatchmaker();

  const ids = users.map((u) => u.id);
  const potAmount = await startRoyaleEntriesOnChain(ids);

  state.royale = {
    status: "running",
    rounds: [buildRound(users.map((u) => ({ id: u.id, name: u.name })))],
    currentRound: 0,
    championId: null,
    championName: null,
    potAmount,
    startedAt: Date.now(),
  };

  runRoyaleLoop().catch((err) => {
    console.error("royale loop failed", err);
    state.royale.status = "idle";
  });
}

function waitForMatch(matchId: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      const m = state.pendingMatches.get(matchId);
      if (!m || m.resolved) {
        resolve();
        return;
      }
      setTimeout(check, 400);
    };
    check();
  });
}

async function runRoyaleLoop() {
  while (true) {
    const round = state.royale.rounds[state.royale.currentRound];
    const winners: { id: string; name: string }[] = [];

    const waits: Promise<void>[] = [];
    for (const pairing of round) {
      if (pairing.bId === null) continue; // bye, handled below
      const m = createPendingMatch(pairing.aId, pairing.aName, pairing.bId, pairing.bName!, "royale");
      pairing.matchId = m.id;
      waits.push(waitForMatch(m.id));
    }
    await Promise.all(waits);

    for (const pairing of round) {
      if (pairing.bId === null) {
        winners.push({ id: pairing.aId, name: pairing.aName });
        continue;
      }
      const m = pairing.matchId ? state.pendingMatches.get(pairing.matchId) : undefined;
      const outcome = m?.outcome as { winnerId: string; loserId: string; decidedByAnswer: boolean } | undefined;
      if (!outcome) {
        // both resolution attempts failed — advance nobody from this pairing rather
        // than hang the whole bracket; extremely unlikely, but fail safe.
        continue;
      }
      const winnerName = outcome.winnerId === pairing.aId ? pairing.aName : pairing.bName!;
      const loserName = outcome.loserId === pairing.aId ? pairing.aName : pairing.bName!;
      pairing.result = { winnerName, loserName, decidedByAnswer: outcome.decidedByAnswer };
      winners.push({ id: outcome.winnerId, name: winnerName });
    }

    if (winners.length <= 1) {
      state.royale.status = "done";
      if (winners.length === 1) {
        state.royale.championId = winners[0].id;
        state.royale.championName = winners[0].name;
        await payRoyaleChampionOnChain(winners[0].id, state.royale.potAmount);
      }
      return;
    }

    const nextRound = buildRound(winners);
    state.royale.rounds.push(nextRound);
    state.royale.currentRound += 1;
    await new Promise((r) => setTimeout(r, 600));
  }
}

export async function loadUsers() {
  return fetchUsers();
}
