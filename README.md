# BitAgents Arena

Name your agent, teach it a handful of facts a stock AI doesn't know, then throw it into
the arena. Whichever agent was actually taught the drawn question wins outright; on a
knowledge tie, stats settle it. Every battle is a real on-chain transaction, resolved in
well under a second, with a live Elo rating on the line — no wallet, no gas, no signup.

Built for Monad Blitz London.

## Why Monad

Every teach action and every battle is its own transaction on Monad Testnet. Casual
matches auto-resolve every ~5 seconds, and Battle Royale brackets an entire room and
rips through every round live — that's only possible because Monad finalizes in ~0.6s.
On a slower chain you'd have to fake the live feeling with an off-chain server and
checkpoint later, which undercuts the whole "nobody could rig who won" pitch. High
throughput means a room full of people teaching and battling simultaneously doesn't
spike gas or stall the demo, and full EVM compatibility is why this got built in a
single sprint — Foundry and viem worked immediately, no new VM to learn under deadline
pressure.

## How it works

- **`contracts/src/Arena.sol`** — on-chain agent registry + battle resolver.
  - Agent names are permanently bound to their id via a name-hash mapping — nobody can
    claim a name that's taken.
  - Each agent has a `uint32 knowledge` bitmask over a shared 32-fact pool
    (`src/lib/factPool.ts`). Teaching a fact sets a bit; a cooldown (45s) paces training
    out over the event instead of letting it be spammed.
  - `battle()` draws a fact pseudo-randomly from chain state. If exactly one agent knows
    it, that agent wins outright; otherwise a stat-weighted roll (attack/speed vs.
    defense) breaks the tie. Either way, a real Elo rating updates on-chain using a
    piecewise-linear approximation of the logistic expectancy curve (Solidity has no
    cheap fixed-point exponent).
  - Covered by Foundry tests (`contracts/test/Arena.t.sol`) — these caught a genuine
    `uint8` multiplication overflow in the combat roll before it ever reached testnet.
- **Stat/flavor generation** (`src/lib/statGen.ts`) turns a player's personality prompt
  into attack/defense/speed/ability/flavor deterministically (keyword + hash based) — no
  external API call, so the live demo has zero dependency on a third-party service.
- **Matchmaking** (`src/lib/gameState.ts`) — an in-memory queue with a 5-second
  matchmaker tick (closest-rating pairing), plus a host-triggered Battle Royale that
  brackets every current agent and streams live progress via polling.
- **Gasless UX**: a single server-held relayer wallet (funded from the Monad testnet
  faucet) signs every transaction on the player's behalf. The player never touches a
  wallet — they just teach and play.

## Local dev

```bash
npm install
npm run dev
```

Requires a `.env.local` (gitignored — not committed, since it holds a relayer private
key):

```
MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz
MONAD_TESTNET_CHAIN_ID=10143
RELAYER_PRIVATE_KEY=0x...            # pays gas for every player action
NEXT_PUBLIC_RELAYER_ADDRESS=0x...
NEXT_PUBLIC_ARENA_CONTRACT_ADDRESS=0x...
```

## Contracts

Deployed on Monad Testnet (chain id `10143`):

- `Arena`: [`0x66b3dEdf95D8499988a98FaF8b3B046aA062aE84`](https://testnet.monadscan.com/address/0x66b3dEdf95D8499988a98FaF8b3B046aA062aE84)

Build/test/deploy with Foundry from `contracts/`:

```bash
forge test
forge script script/Deploy.s.sol:Deploy --rpc-url $MONAD_TESTNET_RPC_URL --broadcast
```

## Submission

Forked from [`monad-developers/monad-blitz-london`](https://github.com/monad-developers/monad-blitz-london)
per the [submission process](https://monad-foundation.notion.site/Submission-Process-cc66367594f2837c898701aabd948402).
Submitted via [blitz.devnads.com](https://blitz.devnads.com).
