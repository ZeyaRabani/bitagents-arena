"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

const STORAGE_KEY = "bithumans:myUser";
const ANSWER_TIMEOUT_MS = 15_000;

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const NEVER_ANSWERED_MS = 0xffffffff;

function formatAnswerMs(ms: number): string {
  if (ms >= NEVER_ANSWERED_MS) return "didn't answer";
  return `${(ms / 1000).toFixed(2)}s`;
}

interface UserRow {
  id: string;
  owner: string;
  name: string;
  balance: number;
  wins: number;
  losses: number;
  createdAt: string;
  lastDripAt: string;
}

interface FeedEntry {
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

interface MyUser {
  id: string;
  name: string;
  nameHash: string;
  txHash: string;
  explorerUrl: string;
}

interface MatchOutcome {
  winnerId: string;
  loserId: string;
  decidedByAnswer: boolean;
  winnerAnswerMs: number;
  loserAnswerMs: number;
  wager?: number;
  winnerBalanceAfter?: number;
  loserBalanceAfter?: number;
  explorerUrl?: string;
  iWon: boolean | null;
  correctIndex: number;
}

interface CurrentMatch {
  id: string;
  mode: "queue" | "royale";
  opponentName: string;
  question: { q: string; options: string[] };
  round: number;
  myAnswer: number | null;
  opponentAnswered: boolean;
  resolved: boolean;
  outcome: MatchOutcome | null;
  createdAt: number;
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
  status: "idle" | "lobby" | "countdown" | "running" | "done";
  participants: { userId: string; name: string }[];
  countdownEndsAt: number | null;
  rounds: RoyaleMatch[][];
  currentRound: number;
  championId: string | null;
  championName: string | null;
  potAmount: number;
}

function timeAgo(ts: number) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

function MoneyReveal({ from, to }: { from: number; to: number }) {
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
  return <span>{money(display)}</span>;
}

type ModalPhase = "idle" | "searching" | "question" | "waiting" | "result";

function MatchModal({
  phase,
  match,
  myName,
  now,
  onAnswer,
  onCancelSearch,
  onClose,
}: {
  phase: ModalPhase;
  match: CurrentMatch | null;
  myName: string;
  now: number;
  onAnswer: (choice: number) => void;
  onCancelSearch: () => void;
  onClose: () => void;
}) {
  if (phase === "idle") return null;

  const remainingMs = match ? Math.max(0, match.createdAt + ANSWER_TIMEOUT_MS - now) : 0;
  const outcome = match?.outcome;

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
            <p className="font-display text-2xl font-bold">{myName}</p>
            <p className="font-mono text-sm text-muted-foreground mt-2 uppercase tracking-widest ba-flash">
              Searching for an opponent...
            </p>
            <button onClick={onCancelSearch} className="mt-8 text-xs text-muted-foreground underline hover:text-foreground">
              Cancel search
            </button>
          </div>
        )}

        {(phase === "question" || phase === "waiting") && match && (
          <div className="ba-pop-in">
            <p className="text-center font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground mb-2">
              vs {match.opponentName} · wagering $0.05
            </p>
            {match.round > 1 && (
              <p className="text-center font-mono text-xs text-signal mb-1 ba-flash">
                both wrong — tiebreak question {match.round}
              </p>
            )}
            <p className="text-center font-mono text-xs text-signal mb-4">{Math.ceil(remainingMs / 1000)}s left</p>
            <h2 className="font-display text-xl font-bold text-center mb-5">{match.question.q}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {match.question.options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => onAnswer(i)}
                  disabled={match.myAnswer !== null}
                  className={`text-left px-4 py-3 border transition text-sm ${
                    match.myAnswer === i
                      ? "border-signal bg-signal/10 text-foreground"
                      : "border-border bg-surface text-muted-foreground hover:text-foreground hover:border-signal"
                  } disabled:cursor-not-allowed`}
                >
                  {opt}
                </button>
              ))}
            </div>
            {phase === "waiting" && (
              <p className="text-center font-mono text-xs text-muted-foreground mt-6 ba-flash">
                {match.opponentAnswered ? "resolving on Monad testnet..." : "waiting for your opponent..."}
              </p>
            )}
          </div>
        )}

        {phase === "result" && match && outcome && (
          <div key={match.id} className="ba-pop-in">
            <p className="text-center font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground mb-4">
              Match resolved
            </p>
            <h2 className="font-display text-lg font-bold text-center mb-3">{match.question.q}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
              {match.question.options.map((opt, i) => (
                <div
                  key={i}
                  className={`px-4 py-3 border text-sm ${
                    i === outcome.correctIndex
                      ? "border-signal bg-signal/10 text-foreground"
                      : "border-border bg-surface text-muted-foreground"
                  }`}
                >
                  {opt} {i === outcome.correctIndex && <span className="text-signal">✓ correct</span>}
                  {i === match.myAnswer && i !== outcome.correctIndex && <span className="text-destructive"> · your pick</span>}
                </div>
              ))}
            </div>

            <div className="text-center">
              <p className="font-display text-3xl font-black">{outcome.iWon ? "🏆 You won" : "Defeated"}</p>
              {outcome.wager !== undefined && (
                <p className="font-mono text-lg mt-1">
                  <span className={outcome.iWon ? "text-signal" : "text-destructive"}>
                    {outcome.iWon ? "+" : "-"}
                    {money(outcome.wager)}
                  </span>{" "}
                  <span className="text-muted-foreground text-sm">
                    (
                    <MoneyReveal
                      from={
                        outcome.iWon
                          ? (outcome.winnerBalanceAfter ?? 0) - outcome.wager
                          : (outcome.loserBalanceAfter ?? 0) + outcome.wager
                      }
                      to={outcome.iWon ? outcome.winnerBalanceAfter ?? 0 : outcome.loserBalanceAfter ?? 0}
                    />
                    )
                  </span>
                </p>
              )}
            </div>

            <div className="mt-5 border border-border bg-surface px-4 py-3">
              <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground mb-1">
                {outcome.decidedByAnswer ? "🧠 Decided by the answer" : "⚡ Decided by speed"}
              </p>
              <p className="text-xs text-muted-foreground">
                {outcome.decidedByAnswer
                  ? "One of you answered correctly and one didn't — the correct answer always wins outright."
                  : "You were both equally right or wrong, so it came down to who answered faster — this is a speed game."}
              </p>
              {!outcome.decidedByAnswer && (
                <p className="text-xs text-muted-foreground mt-1">
                  {formatAnswerMs(outcome.winnerAnswerMs)} vs {formatAnswerMs(outcome.loserAnswerMs)}
                </p>
              )}
            </div>

            {outcome.explorerUrl && (
              <a
                href={outcome.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs text-signal underline mt-3 inline-block"
              >
                view match tx
              </a>
            )}

            <button
              onClick={onClose}
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
  const [myUser, setMyUserState] = useState<MyUser | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [royale, setRoyale] = useState<RoyaleState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [phase, setPhase] = useState<ModalPhase>("idle");
  const [currentMatch, setCurrentMatch] = useState<CurrentMatch | null>(null);
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([]);
  const [siteUrl, setSiteUrl] = useState("");
  const [showRules, setShowRules] = useState(false);
  const toastedAtRef = useRef<number | null>(null);
  const lastMatchIdRef = useRef<string | null>(null);

  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        setMyUserState(JSON.parse(raw));
      } catch {
        // ignore corrupt storage
      }
    }
    setHydrated(true);
    setSiteUrl(window.location.origin);
  }, []);

  function setMyUser(user: MyUser | null) {
    setMyUserState(user);
    if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    else localStorage.removeItem(STORAGE_KEY);
  }

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      if (data.users) setUsers(data.users);
    } catch {
      // ignore
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
    loadUsers();
    loadFeed();
    loadRoyale();
    const t1 = setInterval(loadUsers, 3000);
    const t2 = setInterval(loadFeed, 2500);
    const t3 = setInterval(loadRoyale, 1500);
    const t4 = setInterval(() => setNow(Date.now()), 500);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
      clearInterval(t3);
      clearInterval(t4);
    };
  }, [loadUsers, loadFeed, loadRoyale]);

  // Drives the whole match modal: poll for the player's current match and derive
  // phase purely from what the server says, so it's correct regardless of timing.
  // Keeps polling even while idle — royale matches are pushed by the server (nobody
  // clicks "Play" to get into one), so idle is exactly when we need to notice one.
  useEffect(() => {
    if (!myUser) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/match/mine?userId=${myUser!.id}`);
        const data = await res.json();
        if (cancelled) return;
        const m = data.match as CurrentMatch | null;
        if (!m) return; // still searching, nothing to show yet

        setCurrentMatch(m);
        if (m.resolved) {
          setPhase("result");
          if (lastMatchIdRef.current !== m.id) {
            lastMatchIdRef.current = m.id;
          }
        } else if (m.myAnswer === null) {
          setPhase("question");
        } else {
          setPhase("waiting");
        }
      } catch {
        // ignore transient poll failures
      }
    }

    poll();
    const t = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [myUser]);

  // ambient toasts for any match resolving in the arena, not just ours
  useEffect(() => {
    if (feed.length === 0) return;
    if (toastedAtRef.current === null) {
      toastedAtRef.current = feed[0].at;
      return;
    }
    const newOnes = feed.filter((f) => f.at > toastedAtRef.current!).sort((a, b) => a.at - b.at);
    if (newOnes.length === 0) return;
    toastedAtRef.current = feed[0].at;

    const additions = newOnes.map((f) => ({
      id: `${f.txHash}-${f.at}`,
      text: `${f.winnerName} beat ${f.loserName} for ${money(f.wager)}`,
    }));
    setToasts((prev) => [...prev, ...additions].slice(-4));
    additions.forEach((t) => {
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 4500);
    });
  }, [feed]);

  const me = useMemo(() => users.find((u) => u.id === myUser?.id) ?? null, [users, myUser]);
  const leaderboard = useMemo(() => [...users].sort((a, b) => b.balance - a.balance).slice(0, 8), [users]);

  function short(hash: string) {
    return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/users/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMyUser({ id: data.userId, name, nameHash: data.nameHash, txHash: data.txHash, explorerUrl: data.explorerUrl });
      await loadUsers();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handlePlay() {
    if (!myUser) return;
    setError(null);
    setPhase("searching");
    try {
      const res = await fetch("/api/queue/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: myUser.id, name: myUser.name }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
    } catch (err) {
      setError((err as Error).message);
      setPhase("idle");
    }
  }

  async function handleCancelSearch() {
    if (myUser) {
      fetch("/api/queue/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: myUser.id }),
      }).catch(() => {});
    }
    setPhase("idle");
  }

  async function handleAnswer(choice: number) {
    if (!myUser || !currentMatch) return;
    try {
      await fetch("/api/match/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: currentMatch.id, userId: myUser.id, choice }),
      });
      setCurrentMatch({ ...currentMatch, myAnswer: choice });
      setPhase("waiting");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function closeMatchModal() {
    if (currentMatch?.resolved) {
      fetch("/api/match/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: currentMatch.id }),
      }).catch(() => {});
    }
    setPhase("idle");
    setCurrentMatch(null);
  }

  async function handleStartRoyale() {
    setError(null);
    try {
      const res = await fetch("/api/royale/start", { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.royale) setRoyale(data.royale);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleJoinRoyale() {
    if (!myUser) return;
    setError(null);
    try {
      const res = await fetch("/api/royale/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: myUser.id, name: myUser.name }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.royale) setRoyale(data.royale);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!hydrated) return null;

  const iJoinedRoyale = !!myUser && (royale?.participants.some((p) => p.userId === myUser.id) ?? false);
  const royaleForming = royale?.status === "lobby" || royale?.status === "countdown";
  const royaleCountdownS =
    royale?.status === "countdown" && royale.countdownEndsAt ? Math.max(0, Math.ceil((royale.countdownEndsAt - now) / 1000)) : null;

  return (
    <div className={`min-h-screen bg-background text-foreground p-6 md:p-10 ${myUser && royaleForming ? "pt-16 md:pt-20" : ""}`}>
      {myUser && royaleForming && !iJoinedRoyale && (
        <div className="fixed top-0 inset-x-0 z-40 bg-signal text-primary-foreground ba-pop-in">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="font-mono text-xs sm:text-sm uppercase tracking-wide">
              ⚔️ Battle Royale forming — {royale!.participants.length} joined
              {royaleCountdownS !== null ? ` · starting in ${royaleCountdownS}s` : " · waiting for 4+ to start countdown"}
            </p>
            <button
              onClick={handleJoinRoyale}
              className="px-4 py-1.5 font-mono text-xs font-semibold uppercase tracking-wide bg-primary-foreground text-signal hover:opacity-90 transition"
            >
              Join — $0.05 entry
            </button>
          </div>
        </div>
      )}
      {myUser && royaleForming && iJoinedRoyale && (
        <div className="fixed top-0 inset-x-0 z-40 bg-card border-b border-signal/40 text-foreground ba-pop-in">
          <div className="max-w-5xl mx-auto px-4 py-3 text-center font-mono text-xs sm:text-sm uppercase tracking-wide text-signal">
            You&apos;re in! {royale!.participants.length} joined
            {royaleCountdownS !== null ? ` · starting in ${royaleCountdownS}s` : " · waiting for 4+ players"}
          </div>
        </div>
      )}
      <header className="max-w-5xl mx-auto text-center mb-8">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2">
          Monad Testnet · {users.length} players · testnet play money only
        </p>
        <h1 className="font-display text-4xl md:text-6xl font-bold tracking-tight">
          BIT<span className="text-signal">HUMANS</span>
        </h1>
        <p className="text-muted-foreground mt-3">
          Real stakes, real-time trivia about Monad and crypto — human vs human, winner takes the pot.
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
          <div className="w-full max-w-sm border border-border bg-card p-6 ba-pop-in relative" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowRules(false)}
              aria-label="Close"
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center border border-border text-muted-foreground hover:text-foreground hover:border-signal transition"
            >
              ✕
            </button>
            <h2 className="font-display text-xl font-bold mb-4">How to play</h2>
            <ol className="grid gap-3 text-sm text-foreground/90 list-decimal list-inside">
              <li>Name yourself. You get $0.30 in testnet play money to start.</li>
              <li>Hit Play — you&apos;ll be matched against another real person.</li>
              <li>Both of you get the same multiple-choice question about Monad or crypto. Pick fast — you&apos;ve got 15 seconds.</li>
              <li>Whoever answers correctly wins the $0.05 wager. If you&apos;re both right or both wrong, whoever answered faster wins.</li>
              <li>
                Battle Royale: anyone can propose one — everyone gets notified and can opt in for $0.05. Once 4+
                have joined, a 30s countdown starts for stragglers, then it's bracketed and the sole survivor takes
                the entire pot.
              </li>
              <li>Balance drips back slowly over time, so you&apos;re never fully out.</li>
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
          <div className="border border-destructive/40 bg-destructive/10 px-4 py-2 text-destructive text-sm">{error}</div>
        )}

        {!myUser ? (
          <form onSubmit={handleCreate} className="grid gap-4 border border-border bg-card p-5">
            <h2 className="font-display text-xl font-bold">Join in</h2>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name — this is permanently yours"
              maxLength={32}
              className="border border-border bg-surface px-4 py-3 outline-none focus:border-signal placeholder:text-muted-foreground"
            />
            <p className="text-xs text-muted-foreground">
              You&apos;ll get $0.30 in testnet play money to start. This is not real money.
            </p>
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="px-6 py-3 font-mono font-semibold uppercase tracking-[0.1em] text-sm bg-signal text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition"
            >
              {creating ? "Creating on-chain..." : "Join"}
            </button>
          </form>
        ) : (
          <section className="border border-border bg-card p-5">
            <div className="flex justify-between items-start flex-wrap gap-2">
              <div>
                <h2 className="font-display text-2xl font-bold">{myUser.name}</h2>
                <p className="font-mono text-xs text-muted-foreground">#{myUser.id}</p>
                {myUser.nameHash && (
                  <p className="font-mono text-xs text-muted-foreground mt-1" title={myUser.nameHash}>
                    hash {short(myUser.nameHash)}
                  </p>
                )}
                {myUser.explorerUrl && (
                  <a href={myUser.explorerUrl} target="_blank" rel="noreferrer" className="font-mono text-xs text-signal underline">
                    view creation tx
                  </a>
                )}
              </div>
              <div className="text-right">
                <p className="font-display text-3xl font-bold text-signal">{me ? money(me.balance) : "..."}</p>
                <p className="font-mono text-xs text-muted-foreground uppercase">balance</p>
              </div>
            </div>

            {me && (
              <>
                <div className="flex gap-4 font-mono text-xs text-muted-foreground mt-3">
                  <span>
                    {me.wins}W - {me.losses}L
                  </span>
                </div>

                <div className="mt-5">
                  <button
                    onClick={handlePlay}
                    disabled={phase !== "idle" || me.balance < 5}
                    className="w-full px-6 py-4 font-mono font-bold uppercase tracking-[0.1em] bg-signal text-primary-foreground disabled:opacity-60 hover:opacity-90 transition"
                  >
                    {phase === "searching" ? "Searching for opponent..." : me.balance < 5 ? "Not enough balance" : "Play — wager $0.05"}
                  </button>
                </div>
              </>
            )}

            <button onClick={() => setMyUser(null)} className="mt-6 text-xs text-muted-foreground underline hover:text-foreground">
              Use a different name
            </button>
          </section>
        )}

        <section>
          <h2 className="font-display text-xl font-bold mb-3">Leaderboard</h2>
          <ol className="grid gap-px border border-border bg-border">
            {leaderboard.map((u, i) => (
              <li key={u.id} className={`flex justify-between px-4 py-2 text-sm ${u.id === myUser?.id ? "bg-signal/10" : "bg-card"}`}>
                <span>
                  <span className="font-mono text-muted-foreground mr-2">#{i + 1}</span>
                  {u.name}
                </span>
                <span className="font-mono text-signal">{money(u.balance)}</span>
              </li>
            ))}
            {leaderboard.length === 0 && <p className="text-muted-foreground text-sm bg-card px-4 py-2">No players yet.</p>}
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
                    · {f.decidedByAnswer ? "knew it" : "was faster"} · +{money(f.wager)}
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
            {feed.length === 0 && <p className="text-muted-foreground text-sm bg-card px-4 py-2">No matches yet.</p>}
          </ol>
        </section>

        <section className="border border-border bg-card p-5">
          <div className="flex justify-between items-center flex-wrap gap-2 mb-4">
            <h2 className="font-display text-xl font-bold">Battle Royale</h2>
            {royaleForming ? (
              !iJoinedRoyale ? (
                <button
                  onClick={handleJoinRoyale}
                  className="px-4 py-2 font-mono text-xs uppercase tracking-wide bg-signal text-primary-foreground hover:opacity-90 transition"
                >
                  Join — $0.05 entry
                </button>
              ) : (
                <span className="px-4 py-2 font-mono text-xs uppercase tracking-wide text-signal">
                  You&apos;re in{royaleCountdownS !== null ? ` · ${royaleCountdownS}s` : ""}
                </span>
              )
            ) : (
              <button
                onClick={handleStartRoyale}
                disabled={royale?.status === "running"}
                className="px-4 py-2 font-mono text-xs uppercase tracking-wide bg-signal text-primary-foreground disabled:opacity-40 hover:opacity-90 transition"
              >
                {royale?.status === "running" ? "Running..." : "Form Battle Royale"}
              </button>
            )}
          </div>

          {royaleForming && (
            <div className="mb-4">
              <p className="font-mono text-xs text-muted-foreground mb-2">
                {royale!.participants.length} joined
                {royaleCountdownS !== null
                  ? ` · starting in ${royaleCountdownS}s`
                  : ` · needs ${Math.max(0, 4 - royale!.participants.length)} more to start the countdown`}
              </p>
              <div className="flex flex-wrap gap-2">
                {royale!.participants.map((p) => (
                  <span key={p.userId} className="font-mono text-xs border border-signal/40 bg-signal/10 px-2 py-1 text-signal">
                    {p.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {royale && royale.rounds.length > 0 ? (
            <>
              <p className="font-mono text-xs text-muted-foreground mb-3">Pot: {money(royale.potAmount)}</p>
              <div className="flex gap-4 overflow-x-auto pb-2">
                {royale.rounds.map((round, ri) => (
                  <div key={ri} className="min-w-[200px]">
                    <p className="font-mono text-xs uppercase text-muted-foreground mb-2">Round {ri + 1}</p>
                    <div className="grid gap-2">
                      {round.map((m, mi) => (
                        <div key={mi} className="border border-border bg-surface px-3 py-2 text-xs">
                          <div className={m.result?.winnerName === m.aName ? "text-signal font-semibold" : ""}>{m.aName}</div>
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
            </>
          ) : !royaleForming ? (
            <p className="text-muted-foreground text-sm">
              Anyone who joins gets bracketed once the countdown ends. The last player standing takes the whole pot.
            </p>
          ) : null}

          {royale?.status === "done" && royale.championName && (
            <div className="mt-4 border border-signal/40 bg-signal/10 px-4 py-3 font-display text-lg font-bold text-signal">
              🏆 {royale.championName} wins {money(royale.potAmount)}
            </div>
          )}
        </section>
      </main>

      <MatchModal
        phase={phase}
        match={currentMatch}
        myName={myUser?.name ?? ""}
        now={now}
        onAnswer={handleAnswer}
        onCancelSearch={handleCancelSearch}
        onClose={closeMatchModal}
      />

      {siteUrl && (
        <div className="hidden lg:flex fixed top-24 right-6 z-30 flex-col items-center gap-3 border border-border bg-card p-4 w-48 ba-fade-in">
          <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground text-center">Scan to join</p>
          <div className="bg-white p-2">
            <QRCodeSVG value={siteUrl} size={140} bgColor="#ffffff" fgColor="#0c0a09" />
          </div>
          <p className="font-mono text-[10px] text-muted-foreground text-center break-all">{siteUrl}</p>
        </div>
      )}

      <div className="fixed top-4 right-4 z-40 flex flex-col gap-2 max-w-xs">
        {toasts.map((t) => (
          <div key={t.id} className="ba-slide-right bg-card border border-border px-4 py-2 text-xs shadow-lg">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
