import { fetchAgents, battleOnChain, type BattleOutcome, type OnChainAgent } from "./arenaActions";

export interface FeedEntry extends BattleOutcome {
  winnerName: string;
  loserName: string;
  at: number;
  mode: "queue" | "royale";
}

interface Match {
  aId: string;
  bId: string | null; // null = bye
  aName: string;
  bName: string | null;
  result: FeedEntry | null;
}

interface RoyaleState {
  status: "idle" | "running" | "done";
  rounds: Match[][];
  currentRound: number;
  championId: string | null;
  championName: string | null;
  startedAt: number | null;
}

interface GameState {
  queue: { agentId: string; name: string; joinedAt: number }[];
  feed: FeedEntry[];
  royale: RoyaleState;
  matchmakerStarted: boolean;
}

const g = globalThis as unknown as { __bitagentsState?: GameState };

function initState(): GameState {
  return {
    queue: [],
    feed: [],
    royale: { status: "idle", rounds: [], currentRound: 0, championId: null, championName: null, startedAt: null },
    matchmakerStarted: false,
  };
}

export const state: GameState = g.__bitagentsState ?? (g.__bitagentsState = initState());

function pushFeed(entry: FeedEntry) {
  state.feed.unshift(entry);
  state.feed = state.feed.slice(0, 30);
}

async function runBattle(idA: string, idB: string, nameA: string, nameB: string, mode: "queue" | "royale"): Promise<FeedEntry> {
  const outcome = await battleOnChain(idA, idB);
  const entry: FeedEntry = {
    ...outcome,
    winnerName: outcome.winnerId === idA ? nameA : nameB,
    loserName: outcome.loserId === idA ? nameA : nameB,
    at: Date.now(),
    mode,
  };
  pushFeed(entry);
  return entry;
}

export function joinQueue(agentId: string, name: string) {
  if (state.queue.some((q) => q.agentId === agentId)) return;
  state.queue.push({ agentId, name, joinedAt: Date.now() });
}

export function queueSnapshot() {
  return state.queue;
}

let matchmakerTimer: ReturnType<typeof setInterval> | null = null;

export function startMatchmaker() {
  if (state.matchmakerStarted) return;
  state.matchmakerStarted = true;

  matchmakerTimer = setInterval(async () => {
    if (state.queue.length < 2) return;
    try {
      const agents = await fetchAgents();
      const ratingOf = (id: string) => agents.find((a) => a.id === id)?.rating ?? 1000;

      const entries = [...state.queue].sort((x, y) => ratingOf(x.agentId) - ratingOf(y.agentId));
      const pairs: [typeof entries[0], typeof entries[0]][] = [];
      for (let i = 0; i + 1 < entries.length; i += 2) {
        pairs.push([entries[i], entries[i + 1]]);
      }
      const paired = new Set(pairs.flat().map((e) => e.agentId));
      state.queue = state.queue.filter((q) => !paired.has(q.agentId));

      for (const [a, b] of pairs) {
        await runBattle(a.agentId, b.agentId, a.name, b.name, "queue");
      }
    } catch (err) {
      console.error("matchmaker tick failed", err);
    }
  }, 5000);
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildRound(participants: { id: string; name: string }[]): Match[] {
  const shuffled = shuffle(participants);
  const round: Match[] = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    const a = shuffled[i];
    const b = shuffled[i + 1];
    round.push({
      aId: a.id,
      bId: b ? b.id : null,
      aName: a.name,
      bName: b ? b.name : null,
      result: null,
    });
  }
  return round;
}

export function royaleSnapshot() {
  return state.royale;
}

export async function startRoyale(agents: OnChainAgent[]) {
  if (agents.length < 2) throw new Error("need at least 2 agents for a royale");

  state.royale = {
    status: "running",
    rounds: [buildRound(agents.map((a) => ({ id: a.id, name: a.name })))],
    currentRound: 0,
    championId: null,
    championName: null,
    startedAt: Date.now(),
  };

  runRoyaleLoop().catch((err) => {
    console.error("royale loop failed", err);
    state.royale.status = "idle";
  });
}

async function runRoyaleLoop() {
  while (true) {
    const round = state.royale.rounds[state.royale.currentRound];
    const winners: { id: string; name: string }[] = [];

    for (const match of round) {
      if (match.bId === null) {
        // bye — auto-advance
        winners.push({ id: match.aId, name: match.aName });
        continue;
      }
      const entry = await runBattle(match.aId, match.bId, match.aName, match.bName!, "royale");
      match.result = entry;
      const winnerName = entry.winnerId === match.aId ? match.aName : match.bName!;
      winners.push({ id: entry.winnerId, name: winnerName });
      await new Promise((r) => setTimeout(r, 400));
    }

    if (winners.length === 1) {
      state.royale.status = "done";
      state.royale.championId = winners[0].id;
      state.royale.championName = winners[0].name;
      return;
    }

    const nextRound = buildRound(winners);
    state.royale.rounds.push(nextRound);
    state.royale.currentRound += 1;
    await new Promise((r) => setTimeout(r, 800));
  }
}
