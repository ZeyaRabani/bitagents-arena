"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  ratingDelta: string;
  winnerRatingAfter: number;
  loserRatingAfter: number;
  at: number;
  mode: "queue" | "royale";
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

export default function Home() {
  const [myAgent, setMyAgentState] = useState<{ id: string; name: string } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [royale, setRoyale] = useState<RoyaleState | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

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
  }, []);

  function setMyAgent(agent: { id: string; name: string } | null) {
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

  // detect our queue match resolving
  useEffect(() => {
    if (!searching || !myAgent) return;
    const mine = feed.find((f) => f.winnerId === myAgent.id || f.loserId === myAgent.id);
    if (mine && Date.now() - mine.at < 15000) {
      setSearching(false);
    }
  }, [feed, searching, myAgent]);

  const me = useMemo(() => agents.find((a) => a.id === myAgent?.id) ?? null, [agents, myAgent]);
  const leaderboard = useMemo(() => [...agents].sort((a, b) => b.rating - a.rating).slice(0, 8), [agents]);
  const myKnown = me ? bitmaskToFacts(me.knowledge) : [];
  const myUnknown = me ? FACT_POOL.filter((f) => !myKnown.some((k) => k.id === f.id)) : [];
  const cooldownRemaining = me ? TRAIN_COOLDOWN_MS - (now - Number(me.lastTrainedAt) * 1000) : 0;

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
      setMyAgent({ id: data.agentId, name });
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
    setSearching(true);
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
      setSearching(false);
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
      </header>

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
                    disabled={searching}
                    className="w-full px-6 py-4 font-mono font-bold uppercase tracking-[0.1em] bg-signal text-primary-foreground disabled:opacity-60 hover:opacity-90 transition"
                  >
                    {searching ? "Searching for opponent..." : "Play"}
                  </button>
                </div>

                <div className="mt-6">
                  <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground mb-2">
                    Known facts ({myKnown.length}/{FACT_POOL.length})
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
                    Train {cooldownRemaining > 0 && `— next in ${Math.ceil(cooldownRemaining / 1000)}s`}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                    {myUnknown.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => handleTrain(f.id)}
                        disabled={cooldownRemaining > 0}
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
                  </span>
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
    </div>
  );
}
