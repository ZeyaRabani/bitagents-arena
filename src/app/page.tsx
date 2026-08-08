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
    <div className="min-h-screen bg-gradient-to-b from-indigo-950 via-slate-950 to-black text-white p-6 md:p-10">
      <header className="max-w-5xl mx-auto text-center mb-8">
        <h1 className="text-4xl md:text-6xl font-black tracking-tight bg-gradient-to-r from-fuchsia-400 via-violet-400 to-cyan-400 bg-clip-text text-transparent">
          BITAGENTS ARENA
        </h1>
        <p className="text-slate-400 mt-2">
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
            className="flex-1 rounded-xl bg-white/10 border border-white/20 px-4 py-3 outline-none focus:border-fuchsia-400 placeholder:text-slate-500"
          />
          <button
            type="submit"
            disabled={creating || !prompt.trim()}
            className="rounded-xl px-6 py-3 font-bold bg-gradient-to-r from-fuchsia-500 to-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition"
          >
            {creating ? "Spawning..." : "Spawn Agent"}
          </button>
        </form>

        {error && (
          <div className="rounded-lg bg-red-500/20 border border-red-500/40 px-4 py-2 text-red-200 text-sm">
            {error}
          </div>
        )}

        {lastResult && (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-400/30 px-4 py-3 text-sm">
            <span className="font-bold text-emerald-300">
              Agent #{lastResult.winnerId}
            </span>{" "}
            beat Agent #{lastResult.loserId} ({lastResult.winnerRoll} vs {lastResult.loserRoll}) —{" "}
            <a href={lastResult.explorerUrl} target="_blank" rel="noreferrer" className="underline text-cyan-300">
              view tx
            </a>
          </div>
        )}

        <section>
          <h2 className="text-xl font-bold mb-3 text-slate-200">
            Arena {selected && <span className="text-fuchsia-400">— pick an opponent for #{selected}</span>}
            {battling && <span className="text-cyan-400"> — battling on-chain...</span>}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((a) => (
              <button
                key={a.id}
                onClick={() => handlePick(a.id)}
                disabled={battling}
                className={`text-left rounded-xl p-4 border transition bg-white/5 hover:bg-white/10 ${
                  selected === a.id ? "border-fuchsia-400 ring-2 ring-fuchsia-400" : "border-white/10"
                }`}
              >
                <div className="flex justify-between items-start">
                  <h3 className="font-bold text-lg">{a.name}</h3>
                  <span className="text-xs text-slate-400">#{a.id}</span>
                </div>
                <p className="text-xs text-fuchsia-300 mb-1">{a.ability}</p>
                <p className="text-xs text-slate-400 italic mb-2 line-clamp-2">{a.flavor}</p>
                <div className="flex gap-3 text-xs text-slate-300">
                  <span>ATK {a.attack}</span>
                  <span>DEF {a.defense}</span>
                  <span>SPD {a.speed}</span>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  {a.wins}W - {a.losses}L
                </div>
              </button>
            ))}
            {agents.length === 0 && (
              <p className="text-slate-500 text-sm">No agents yet — spawn the first one above.</p>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold mb-3 text-slate-200">Leaderboard</h2>
          <ol className="grid gap-2">
            {leaderboard.map((a, i) => (
              <li key={a.id} className="flex justify-between rounded-lg bg-white/5 px-4 py-2 text-sm">
                <span>
                  <span className="text-slate-500 mr-2">#{i + 1}</span>
                  {a.name}
                </span>
                <span className="text-emerald-400">{a.wins}W</span>
              </li>
            ))}
            {leaderboard.length === 0 && <p className="text-slate-500 text-sm">No battles yet.</p>}
          </ol>
        </section>
      </main>
    </div>
  );
}
