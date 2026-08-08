"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { FACT_POOL, MAX_STARTING_FACTS, bitmaskToFacts } from "@/lib/factPool";

const TRAIN_COOLDOWN_MS = 45_000;
const STORAGE_KEY = "bitagents:myAgent";

interface Agent {
  id: string;
  owner: string;
  name: string;
  ability: string;
  flavor: string;
  attack: number;
  defense: number;
  speed: number;
  wins: number;
  losses: number;
  rating: number;
  knowledge: number;
  knowledgeCap: number;
  createdAt: string;
  lastTrainedAt: string;
}

interface FeedEntry {
  winnerId: string;
  loserId: string;
  winnerName: string;
  loserName: string;
  factId: number;
  decidedByKnowledge: boolean;
  winnerRoll: string;
  loserRoll: string;
  ratingDelta: string;
  winnerRatingAfter: number;
  loserRatingAfter: number;
  txHash: string;
  explorerUrl: string;
  at: number;
  mode: "queue" | "royale";
}

interface MyAgent {
  id: string;
  name: string;
  nameHash: string;
  txHash: string;
  explorerUrl: string;
}

interface Match {
  aId: string;
  bId: string | null;
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
}

function timeAgo(ts: number) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

type BattlePhase = "idle" | "searching" | "found" | "starting" | "clash" | "result";

const MIN_SEARCH_MS = 3000;

const PHASE_DURATIONS: Partial<Record<BattlePhase, number>> = {
  found: 2800,
  starting: 2400,
  clash: 1800,
};

function RatingReveal({ from, to }: { from: number; to: number }) {
  const [display, setDisplay] = useState(from);
  useEffect(() => {
    const start = performance.now();
    const duration = 900;
    let raf: number;
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(Math.round(from + (to - from) * t));
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <span>{display}</span>;
}

function StartingCountdown() {
  const steps = ["3", "2", "1", "FIGHT!"];
  const [i, setI] = useState(0);
  useEffect(() => {
    if (i >= steps.length - 1) return;
    const t = setTimeout(() => setI((v) => v + 1), 600);
    return () => clearTimeout(t);
  }, [i]);
  return (
    <p key={i} className="text-center font-display text-5xl font-black mt-6 text-signal ba-pop-in">
      {steps[i]}
    </p>
  );
}

interface CombatAgent {
  name: string;
  ability: string;
  flavor: string;
  knowledge: number;
}

function AgentCombatCard({
  agent,
  side,
  outcome,
}: {
  agent: CombatAgent | null;
  side: "left" | "right";
  outcome?: "winner" | "loser";
}) {
  const knownCount = agent ? bitmaskToFacts(agent.knowledge).length : 0;
  return (
    <div
      className={`flex-1 border p-4 text-center ${side === "left" ? "ba-slide-left" : "ba-slide-right"} ${
        outcome === "winner"
          ? "border-signal bg-signal/10"
          : outcome === "loser"
            ? "border-border bg-surface opacity-50"
            : "border-border bg-surface"
      }`}
    >
      <p className="font-display text-xl font-bold truncate">{agent?.name ?? "..."}</p>
      {agent && (
        <div className="mt-2">
          <p className="font-mono text-[10px] uppercase tracking-wide text-signal">{agent.ability}</p>
          <p className="text-xs text-muted-foreground italic mt-1 line-clamp-2">{agent.flavor}</p>
          <p className="font-mono text-[10px] text-muted-foreground mt-2">
            trained on {knownCount}/5 thing{knownCount === 1 ? "" : "s"}
          </p>
        </div>
      )}
      {outcome === "winner" && <p className="mt-3 font-mono text-xs uppercase text-signal">Winner</p>}
    </div>
  );
}

function BattleModal({
  phase,
  me,
  opponent,
  entry,
  isMeWinner,
  onContinue,
  onCancelSearch,
  onClose,
}: {
  phase: BattlePhase;
  me: CombatAgent | null;
  opponent: CombatAgent | null;
  entry: FeedEntry | null;
  isMeWinner: boolean;
  onContinue: () => void;
  onCancelSearch: () => void;
  onClose: () => void;
}) {
  if (phase === "idle") return null;

  const fact = entry ? FACT_POOL[entry.factId] : null;
  const myRatingAfter = entry ? (isMeWinner ? entry.winnerRatingAfter : entry.loserRatingAfter) : 0;
  const delta = entry ? Number(entry.ratingDelta) : 0;
  const myRatingBefore = isMeWinner ? myRatingAfter - delta : myRatingAfter + delta;

  const factBit = entry ? 1 << entry.factId : 0;
  const meKnewFact = !!(me && factBit && me.knowledge & factBit);
  const oppKnewFact = !!(opponent && factBit && opponent.knowledge & factBit);
  const statsExplainer =
    meKnewFact && oppKnewFact
      ? "Both agents had been taught this, so it came down to stats"
      : "Neither agent had been taught this, so it came down to stats";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm p-6 ba-fade-in">
      {phase !== "searching" && (
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-6 right-6 w-9 h-9 flex items-center justify-center border border-border text-muted-foreground hover:text-foreground hover:border-signal transition"
        >
          ✕
        </button>
      )}
      <div className="w-full max-w-lg">
        {phase === "searching" && (
          <div className="text-center ba-fade-in">
            <div className="mx-auto w-24 h-24 rounded-full border-4 border-signal/30 border-t-signal animate-spin mb-6" />
            <p className="font-display text-2xl font-bold">{me?.name}</p>
            <p className="font-mono text-sm text-muted-foreground mt-2 uppercase tracking-widest ba-flash">
              Searching for an opponent...
            </p>
            <button
              onClick={onCancelSearch}
              className="mt-8 text-xs text-muted-foreground underline hover:text-foreground"
            >
              Cancel search
            </button>
          </div>
        )}

        {(phase === "found" || phase === "starting" || phase === "clash") && (
          <>
            <p className="text-center font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground mb-4 ba-fade-in">
              {phase === "found" && "Opponent found"}
              {phase === "starting" && "Get ready"}
              {phase === "clash" && "Fighting on-chain..."}
            </p>
            <div className={`flex items-center gap-3 ${phase === "clash" ? "ba-shake" : ""}`}>
              <AgentCombatCard agent={me} side="left" />
              <span className="font-display text-2xl font-black text-signal shrink-0">VS</span>
              <AgentCombatCard agent={opponent} side="right" />
            </div>
            {phase === "starting" && <StartingCountdown />}
            {phase === "clash" && (
              <p className="text-center font-mono text-sm mt-6 text-muted-foreground ba-flash">
                resolving on Monad testnet...
              </p>
            )}
          </>
        )}

        {phase === "result" && entry && (
          <div key={entry.txHash} className="ba-pop-in">
            <p className="text-center font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground mb-4">
              Battle resolved
            </p>
            <div className="flex items-center gap-3">
              <AgentCombatCard agent={me} side="left" outcome={isMeWinner ? "winner" : "loser"} />
              <span className="font-display text-2xl font-black text-muted-foreground shrink-0">VS</span>
              <AgentCombatCard agent={opponent} side="right" outcome={isMeWinner ? "loser" : "winner"} />
            </div>

            <div className="text-center mt-6">
              <p className={`font-display text-3xl font-black ${isMeWinner ? "ba-pop-in" : ""}`}>
                {isMeWinner ? "🏆 You won" : "Defeated"}
              </p>
              <p className="font-mono text-lg mt-1">
                <span className={isMeWinner ? "text-signal" : "text-destructive"}>
                  {isMeWinner ? "+" : "-"}
                  {delta}
                </span>{" "}
                <span className="text-muted-foreground text-sm">
                  (<RatingReveal from={myRatingBefore} to={myRatingAfter} /> rating)
                </span>
              </p>
            </div>

            {fact && (
              <div className="mt-5 border border-border bg-surface px-4 py-3">
                <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground mb-1">
                  {entry.decidedByKnowledge ? "🧠 Decided by knowledge" : "🎲 Decided by stats"}
                </p>
                <p className="text-sm">
                  The question was <span className="text-foreground font-semibold">&ldquo;{fact.q}&rdquo;</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {entry.decidedByKnowledge
                    ? `${entry.winnerName} had been taught this — ${entry.loserName} hadn't. Knowledge beats stats every time.`
                    : `${statsExplainer} — higher attack & speed wins the roll. ${entry.winnerName} scored ${entry.winnerRoll} to ${entry.loserName}'s ${entry.loserRoll}.`}
                </p>
              </div>
            )}

            <a
              href={entry.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs text-signal underline mt-3 inline-block"
            >
              view battle tx
            </a>

            <button
              onClick={onContinue}
              className="w-full mt-4 px-6 py-3 font-mono font-semibold uppercase tracking-[0.1em] text-sm bg-signal text-primary-foreground hover:opacity-90 transition"
            >
              Continue
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [myAgent, setMyAgentState] = useState<MyAgent | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [royale, setRoyale] = useState<RoyaleState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [battlePhase, setBattlePhase] = useState<BattlePhase>("idle");
  const [battleEntry, setBattleEntry] = useState<FeedEntry | null>(null);
  const [battleOpponent, setBattleOpponent] = useState<Agent | null>(null);
  const [battleSelf, setBattleSelf] = useState<Agent | null>(null);
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([]);
  const [siteUrl, setSiteUrl] = useState("");
  const [showRules, setShowRules] = useState(false);
  const lastHandledBattleAt = useRef<number>(0);
  const searchStartedAt = useRef<number>(0);
  const toastedAtRef = useRef<number | null>(null);

  // create-form state
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [chosenFacts, setChosenFacts] = useState<number[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        setMyAgentState(JSON.parse(raw));
      } catch {
        // ignore corrupt storage
      }
    }
    setHydrated(true);
    setSiteUrl(window.location.origin);
  }, []);

  function setMyAgent(agent: MyAgent | null) {
    setMyAgentState(agent);
    if (agent) localStorage.setItem(STORAGE_KEY, JSON.stringify(agent));
    else localStorage.removeItem(STORAGE_KEY);
  }

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      if (data.agents) setAgents(data.agents);
    } catch {
      // ignore transient poll failures
    }
  }, []);

  const loadFeed = useCallback(async () => {
    try {
      const res = await fetch("/api/feed");
      const data = await res.json();
      if (data.feed) setFeed(data.feed);
    } catch {
      // ignore
    }
  }, []);

  const loadRoyale = useCallback(async () => {
    try {
      const res = await fetch("/api/royale/state");
      const data = await res.json();
      if (data.royale) setRoyale(data.royale);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadAgents();
    loadFeed();
    loadRoyale();
    const t1 = setInterval(loadAgents, 3000);
    const t2 = setInterval(loadFeed, 2500);
    const t3 = setInterval(loadRoyale, 1500);
    const t4 = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
      clearInterval(t3);
      clearInterval(t4);
    };
  }, [loadAgents, loadFeed, loadRoyale]);

  // detect our queue match resolving and kick off the dramatic reveal sequence —
  // enforces a minimum "searching" duration so it never feels like an instant
  // auto-challenge, even if the matchmaker paired us within a second.
  useEffect(() => {
    if (battlePhase !== "searching" || !myAgent) return;
    const mine = feed.find(
      (f) => f.mode === "queue" && (f.winnerId === myAgent.id || f.loserId === myAgent.id) && f.at > lastHandledBattleAt.current
    );
    if (!mine) return;

    lastHandledBattleAt.current = mine.at;
    const opponentId = mine.winnerId === myAgent.id ? mine.loserId : mine.winnerId;
    const opponent = agents.find((a) => a.id === opponentId) ?? null;
    const self = agents.find((a) => a.id === myAgent.id) ?? null;

    const elapsed = Date.now() - searchStartedAt.current;
    const remaining = Math.max(0, MIN_SEARCH_MS - elapsed);
    const t = setTimeout(() => {
      setBattleOpponent(opponent);
      setBattleSelf(self);
      setBattleEntry(mine);
      setBattlePhase("found");
    }, remaining);
    return () => clearTimeout(t);
  }, [feed, battlePhase, myAgent, agents]);

  // ambient toasts for any battle happening in the arena, not just ours
  useEffect(() => {
    if (feed.length === 0) return;
    if (toastedAtRef.current === null) {
      toastedAtRef.current = feed[0].at; // baseline on first load, don't backfill history
      return;
    }
    const newOnes = feed.filter((f) => f.at > toastedAtRef.current!).sort((a, b) => a.at - b.at);
    if (newOnes.length === 0) return;
    toastedAtRef.current = feed[0].at;

    const additions = newOnes.map((f) => ({
      id: `${f.txHash}-${f.at}`,
      text: `${f.winnerName} beat ${f.loserName}${f.decidedByKnowledge ? " — knew it!" : ""}`,
    }));
    setToasts((prev) => [...prev, ...additions].slice(-4));
    additions.forEach((t) => {
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 4500);
    });
  }, [feed]);

  function closeBattleModal() {
    setBattlePhase("idle");
    setBattleEntry(null);
    setBattleOpponent(null);
    setBattleSelf(null);
  }

  // auto-advance through the animated beats (found -> starting -> clash) — the player
  // only has to click something once the result is up, or to bail out early via X.
  useEffect(() => {
    const duration = PHASE_DURATIONS[battlePhase];
    if (!duration) return;
    const next: Partial<Record<BattlePhase, BattlePhase>> = { found: "starting", starting: "clash", clash: "result" };
    const t = setTimeout(() => setBattlePhase(next[battlePhase]!), duration);
    return () => clearTimeout(t);
  }, [battlePhase]);

  async function handleCancelSearch() {
    if (myAgent) {
      fetch("/api/queue/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: myAgent.id }),
      }).catch(() => {});
    }
    setBattlePhase("idle");
  }

  const me = useMemo(() => agents.find((a) => a.id === myAgent?.id) ?? null, [agents, myAgent]);
  const leaderboard = useMemo(() => [...agents].sort((a, b) => b.rating - a.rating).slice(0, 8), [agents]);
  const myKnown = me ? bitmaskToFacts(me.knowledge) : [];
  const myUnknown = me ? FACT_POOL.filter((f) => !myKnown.some((k) => k.id === f.id)) : [];
  const cooldownRemaining = me ? TRAIN_COOLDOWN_MS - (now - Number(me.lastTrainedAt) * 1000) : 0;
  const atCap = me ? myKnown.length >= me.knowledgeCap : false;
  const onComeback = me ? me.knowledgeCap > 5 : false;

  function short(hash: string) {
    return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
  }

  function toggleFact(id: number) {
    setChosenFacts((prev) => {
      if (prev.includes(id)) return prev.filter((f) => f !== id);
      if (prev.length >= MAX_STARTING_FACTS) return prev;
      return [...prev, id];
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/agents/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, prompt, factIds: chosenFacts }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMyAgent({
        id: data.agentId,
        name,
        nameHash: data.nameHash,
        txHash: data.txHash,
        explorerUrl: data.explorerUrl,
      });
      await loadAgents();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleTrain(factId: number) {
    if (!myAgent) return;
    setError(null);
    try {
      const res = await fetch("/api/agents/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: myAgent.id, factId }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await loadAgents();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handlePlay() {
    if (!myAgent) return;
    setError(null);
    searchStartedAt.current = Date.now();
    setBattlePhase("searching");
    try {
      const res = await fetch("/api/queue/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: myAgent.id, name: myAgent.name }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
    } catch (err) {
      setError((err as Error).message);
      setBattlePhase("idle");
    }
  }

  async function handleStartRoyale() {
    setError(null);
    try {
      const res = await fetch("/api/royale/start", { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await loadRoyale();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!hydrated) return null;

  return (
    <div className="min-h-screen bg-background text-foreground p-6 md:p-10">
      <header className="max-w-5xl mx-auto text-center mb-8">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2">
          Monad Testnet · {agents.length} agents live
        </p>
        <h1 className="font-display text-4xl md:text-6xl font-bold tracking-tight">
          BITAGENTS <span className="text-signal">ARENA</span>
        </h1>
        <p className="text-muted-foreground mt-3">
          Teach your agent what a stock AI doesn&apos;t know. Battle for real, on-chain, in seconds.
        </p>
        <button
          onClick={() => setShowRules(true)}
          className="mt-3 font-mono text-xs uppercase tracking-wide text-signal underline hover:opacity-80"
        >
          How to play
        </button>
      </header>

      {showRules && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm p-6 ba-fade-in"
          onClick={() => setShowRules(false)}
        >
          <div
            className="w-full max-w-sm border border-border bg-card p-6 ba-pop-in relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowRules(false)}
              aria-label="Close"
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center border border-border text-muted-foreground hover:text-foreground hover:border-signal transition"
            >
              ✕
            </button>
            <h2 className="font-display text-xl font-bold mb-4">How to play</h2>
            <ol className="grid gap-3 text-sm text-foreground/90 list-decimal list-inside">
              <li>Name your agent and teach it up to 5 facts.</li>
              <li>Hit Play — you&apos;ll be matched against another agent.</li>
              <li>
                A random question gets drawn. If only your agent was taught it, you win.
                If neither (or both) knew it, stats decide instead.
              </li>
              <li>Winning and losing move your rating — climb the leaderboard.</li>
              <li>Lose a match and you get one bonus training slot to catch up.</li>
            </ol>
            <button
              onClick={() => setShowRules(false)}
              className="w-full mt-6 px-6 py-3 font-mono font-semibold uppercase tracking-[0.1em] text-sm bg-signal text-primary-foreground hover:opacity-90 transition"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      <main className="max-w-5xl mx-auto grid gap-8">
        {error && (
          <div className="border border-destructive/40 bg-destructive/10 px-4 py-2 text-destructive text-sm">
            {error}
          </div>
        )}

        {!myAgent ? (
          <form onSubmit={handleCreate} className="grid gap-4 border border-border bg-card p-5">
            <h2 className="font-display text-xl font-bold">Create your agent</h2>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Agent name — this is permanently yours"
              maxLength={32}
              className="border border-border bg-surface px-4 py-3 outline-none focus:border-signal placeholder:text-muted-foreground"
            />
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe its personality (optional) — e.g. a caffeinated hedgehog"
              maxLength={200}
              className="border border-border bg-surface px-4 py-3 outline-none focus:border-signal placeholder:text-muted-foreground"
            />
            <div>
              <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground mb-2">
                Teach it {chosenFacts.length}/{MAX_STARTING_FACTS} facts
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                {FACT_POOL.map((f) => (
                  <button
                    type="button"
                    key={f.id}
                    onClick={() => toggleFact(f.id)}
                    className={`text-left text-xs px-3 py-2 border transition ${
                      chosenFacts.includes(f.id)
                        ? "border-signal bg-signal/10 text-foreground"
                        : "border-border bg-surface text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {f.q}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="px-6 py-3 font-mono font-semibold uppercase tracking-[0.1em] text-sm bg-signal text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition"
            >
              {creating ? "Creating on-chain..." : "Create Agent"}
            </button>
          </form>
        ) : (
          <section className="border border-border bg-card p-5">
            <div className="flex justify-between items-start flex-wrap gap-2">
              <div>
                <h2 className="font-display text-2xl font-bold">{myAgent.name}</h2>
                <p className="font-mono text-xs text-muted-foreground">#{myAgent.id}</p>
                {myAgent.nameHash && (
                  <p className="font-mono text-xs text-muted-foreground mt-1" title={myAgent.nameHash}>
                    hash {short(myAgent.nameHash)}
                  </p>
                )}
                {myAgent.explorerUrl && (
                  <a
                    href={myAgent.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-signal underline"
                  >
                    view creation tx
                  </a>
                )}
              </div>
              <div className="text-right">
                <p className="font-display text-3xl font-bold text-signal">{me?.rating ?? "..."}</p>
                <p className="font-mono text-xs text-muted-foreground uppercase">rating</p>
              </div>
            </div>

            {me && (
              <>
                <div className="flex gap-4 font-mono text-xs text-foreground/80 mt-3">
                  <span>ATK {me.attack}</span>
                  <span>DEF {me.defense}</span>
                  <span>SPD {me.speed}</span>
                  <span className="text-muted-foreground">
                    {me.wins}W - {me.losses}L
                  </span>
                </div>

                <div className="mt-5">
                  <button
                    onClick={handlePlay}
                    disabled={battlePhase !== "idle"}
                    className="w-full px-6 py-4 font-mono font-bold uppercase tracking-[0.1em] bg-signal text-primary-foreground disabled:opacity-60 hover:opacity-90 transition"
                  >
                    {battlePhase === "searching" ? "Searching for opponent..." : "Play"}
                  </button>
                </div>

                <div className="mt-6">
                  <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground mb-2">
                    Known facts ({myKnown.length}/{me.knowledgeCap} cap)
                    {onComeback && <span className="text-signal"> · comeback slot active</span>}
                  </p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {myKnown.map((f) => (
                      <span key={f.id} className="text-xs px-2 py-1 border border-signal/40 text-signal bg-signal/5">
                        {f.q}
                      </span>
                    ))}
                    {myKnown.length === 0 && <span className="text-xs text-muted-foreground">Nothing yet.</span>}
                  </div>

                  <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground mb-2">
                    Train{" "}
                    {atCap
                      ? "— at cap, win or lose a match to change it"
                      : cooldownRemaining > 0 && `— next in ${Math.ceil(cooldownRemaining / 1000)}s`}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                    {myUnknown.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => handleTrain(f.id)}
                        disabled={cooldownRemaining > 0 || atCap}
                        className="text-left text-xs px-3 py-2 border border-border bg-surface text-muted-foreground hover:text-foreground hover:border-signal disabled:opacity-40 disabled:cursor-not-allowed transition"
                      >
                        {f.q}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            <button
              onClick={() => setMyAgent(null)}
              className="mt-6 text-xs text-muted-foreground underline hover:text-foreground"
            >
              Create a different agent
            </button>
          </section>
        )}

        <section>
          <h2 className="font-display text-xl font-bold mb-3">Leaderboard</h2>
          <ol className="grid gap-px border border-border bg-border">
            {leaderboard.map((a, i) => (
              <li
                key={a.id}
                className={`flex justify-between px-4 py-2 text-sm ${
                  a.id === myAgent?.id ? "bg-signal/10" : "bg-card"
                }`}
              >
                <span>
                  <span className="font-mono text-muted-foreground mr-2">#{i + 1}</span>
                  {a.name}
                </span>
                <span className="font-mono text-signal">{a.rating}</span>
              </li>
            ))}
            {leaderboard.length === 0 && <p className="text-muted-foreground text-sm bg-card px-4 py-2">No agents yet.</p>}
          </ol>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold mb-3">Live activity</h2>
          <ol className="grid gap-px border border-border bg-border max-h-72 overflow-y-auto">
            {feed.map((f, i) => (
              <li key={`${f.at}-${i}`} className="bg-card px-4 py-2 text-xs flex justify-between gap-2">
                <span>
                  <span className="text-signal font-semibold">{f.winnerName}</span>{" "}
                  <span className="text-muted-foreground">beat</span> {f.loserName}
                  <span className="text-muted-foreground">
                    {" "}
                    · {f.decidedByKnowledge ? "knew the answer" : "won on stats"} · +{f.ratingDelta}
                  </span>{" "}
                  {f.explorerUrl && (
                    <a href={f.explorerUrl} target="_blank" rel="noreferrer" className="text-signal underline">
                      tx
                    </a>
                  )}
                </span>
                <span className="text-muted-foreground shrink-0">{timeAgo(f.at)}</span>
              </li>
            ))}
            {feed.length === 0 && <p className="text-muted-foreground text-sm bg-card px-4 py-2">No battles yet.</p>}
          </ol>
        </section>

        <section className="border border-border bg-card p-5">
          <div className="flex justify-between items-center flex-wrap gap-2 mb-4">
            <h2 className="font-display text-xl font-bold">Battle Royale</h2>
            <button
              onClick={handleStartRoyale}
              disabled={royale?.status === "running"}
              className="px-4 py-2 font-mono text-xs uppercase tracking-wide bg-signal text-primary-foreground disabled:opacity-40 hover:opacity-90 transition"
            >
              {royale?.status === "running" ? "Running..." : "Start Royale"}
            </button>
          </div>

          {royale && royale.rounds.length > 0 ? (
            <div className="flex gap-4 overflow-x-auto pb-2">
              {royale.rounds.map((round, ri) => (
                <div key={ri} className="min-w-[200px]">
                  <p className="font-mono text-xs uppercase text-muted-foreground mb-2">Round {ri + 1}</p>
                  <div className="grid gap-2">
                    {round.map((m, mi) => (
                      <div key={mi} className="border border-border bg-surface px-3 py-2 text-xs">
                        <div className={m.result?.winnerName === m.aName ? "text-signal font-semibold" : ""}>
                          {m.aName}
                        </div>
                        <div className="text-muted-foreground">vs</div>
                        <div className={m.bName && m.result?.winnerName === m.bName ? "text-signal font-semibold" : ""}>
                          {m.bName ?? "bye"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Everyone with an agent gets bracketed and battles through in seconds. Hit start when the room&apos;s
              ready.
            </p>
          )}

          {royale?.status === "done" && royale.championName && (
            <div className="mt-4 border border-signal/40 bg-signal/10 px-4 py-3 font-display text-lg font-bold text-signal">
              🏆 {royale.championName} wins the arena
            </div>
          )}
        </section>
      </main>

      <BattleModal
        phase={battlePhase}
        me={battlePhase === "searching" ? me : battleSelf}
        opponent={battleOpponent}
        entry={battleEntry}
        isMeWinner={battleEntry?.winnerId === myAgent?.id}
        onContinue={closeBattleModal}
        onCancelSearch={handleCancelSearch}
        onClose={closeBattleModal}
      />

      {siteUrl && (
        <div className="hidden lg:flex fixed top-24 right-6 z-30 flex-col items-center gap-3 border border-border bg-card p-4 w-48 ba-fade-in">
          <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground text-center">
            Scan to join the arena
          </p>
          <div className="bg-white p-2">
            <QRCodeSVG value={siteUrl} size={140} bgColor="#ffffff" fgColor="#0c0a09" />
          </div>
          <p className="font-mono text-[10px] text-muted-foreground text-center break-all">{siteUrl}</p>
        </div>
      )}

      <div className="fixed top-4 right-4 z-40 flex flex-col gap-2 max-w-xs">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="ba-slide-right bg-card border border-border px-4 py-2 text-xs shadow-lg"
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
