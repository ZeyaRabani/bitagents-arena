"use client";

import { useCallback, useEffect, useState } from "react";

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
  createdAt: string;
}

interface BattleResult {
  winnerId: string;
  loserId: string;
  winnerRoll: string;
  loserRoll: string;
  explorerUrl: string;
}

export default function Home() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [battling, setBattling] = useState(false);
  const [lastResult, setLastResult] = useState<BattleResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      if (data.agents) setAgents(data.agents.reverse());
    } catch {
      // ignore transient poll failures
    }
  }, []);

  useEffect(() => {
    loadAgents();
    const interval = setInterval(loadAgents, 4000);
    return () => clearInterval(interval);
  }, [loadAgents]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/agents/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPrompt("");
      await loadAgents();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handlePick(id: string) {
    if (battling) return;
    if (!selected) {
      setSelected(id);
      return;
    }
    if (selected === id) {
      setSelected(null);
      return;
    }
    setBattling(true);
    setError(null);
    try {
      const res = await fetch("/api/battle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idA: selected, idB: id }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setLastResult({ ...data.result, explorerUrl: data.explorerUrl });
      await loadAgents();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSelected(null);
      setBattling(false);
    }
  }

  const leaderboard = [...agents].sort((a, b) => b.wins - a.wins).slice(0, 5);

  return (
    <div className="min-h-screen bg-background text-foreground p-6 md:p-10">
      <header className="max-w-5xl mx-auto text-center mb-10">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2">
          Monad Testnet · Live
        </p>
        <h1 className="font-display text-4xl md:text-6xl font-bold tracking-tight text-foreground">
          BITAGENTS <span className="text-signal">ARENA</span>
        </h1>
        <p className="text-muted-foreground mt-3">
          Describe an AI agent. It fights on-chain on Monad, live, in under a second. No wallet needed.
        </p>
      </header>

      <main className="max-w-5xl mx-auto grid gap-8">
        <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-3">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. a caffeinated hedgehog that only attacks in the morning"
            maxLength={200}
            className="flex-1 border border-border bg-surface px-4 py-3 outline-none focus:border-signal placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={creating || !prompt.trim()}
            className="px-6 py-3 font-mono font-semibold uppercase tracking-[0.1em] text-sm bg-signal text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition"
          >
            {creating ? "Spawning..." : "Spawn Agent"}
          </button>
        </form>

        {error && (
          <div className="border border-destructive/40 bg-destructive/10 px-4 py-2 text-destructive text-sm">
            {error}
          </div>
        )}

        {lastResult && (
          <div className="border border-signal/30 bg-signal/10 px-4 py-3 text-sm">
            <span className="font-bold text-signal">Agent #{lastResult.winnerId}</span>{" "}
            beat Agent #{lastResult.loserId} ({lastResult.winnerRoll} vs {lastResult.loserRoll}) —{" "}
            <a href={lastResult.explorerUrl} target="_blank" rel="noreferrer" className="underline text-warn">
              view tx
            </a>
          </div>
        )}

        <section>
          <h2 className="font-display text-xl font-bold mb-3">
            Arena{" "}
            {selected && <span className="text-signal font-mono text-sm">— pick an opponent for #{selected}</span>}
            {battling && <span className="text-warn font-mono text-sm"> — battling on-chain...</span>}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px border border-border bg-border">
            {agents.map((a) => (
              <button
                key={a.id}
                onClick={() => handlePick(a.id)}
                disabled={battling}
                className={`text-left bg-card p-4 transition hover:bg-surface-2 ${
                  selected === a.id ? "ring-2 ring-signal ring-inset" : ""
                }`}
              >
                <div className="flex justify-between items-start">
                  <h3 className="font-display font-bold text-lg">{a.name}</h3>
                  <span className="font-mono text-xs text-muted-foreground">#{a.id}</span>
                </div>
                <p className="font-mono text-xs text-signal mb-1 uppercase tracking-wide">{a.ability}</p>
                <p className="text-xs text-muted-foreground italic mb-2 line-clamp-2">{a.flavor}</p>
                <div className="flex gap-3 font-mono text-xs text-foreground/80">
                  <span>ATK {a.attack}</span>
                  <span>DEF {a.defense}</span>
                  <span>SPD {a.speed}</span>
                </div>
                <div className="mt-2 font-mono text-xs text-muted-foreground">
                  {a.wins}W - {a.losses}L
                </div>
              </button>
            ))}
            {agents.length === 0 && (
              <p className="text-muted-foreground text-sm bg-card p-4">No agents yet — spawn the first one above.</p>
            )}
          </div>
        </section>

        <section>
          <h2 className="font-display text-xl font-bold mb-3">Leaderboard</h2>
          <ol className="grid gap-px border border-border bg-border">
            {leaderboard.map((a, i) => (
              <li key={a.id} className="flex justify-between bg-card px-4 py-2 text-sm">
                <span>
                  <span className="font-mono text-muted-foreground mr-2">#{i + 1}</span>
                  {a.name}
                </span>
                <span className="font-mono text-signal">{a.wins}W</span>
              </li>
            ))}
            {leaderboard.length === 0 && <p className="text-muted-foreground text-sm bg-card px-4 py-2">No battles yet.</p>}
          </ol>
        </section>
      </main>
    </div>
  );
}
