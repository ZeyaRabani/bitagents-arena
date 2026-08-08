# BitAgents Arena

Describe an AI agent in one sentence. It spawns on-chain on Monad, gets stats derived
from your prompt, and can be pitted against any other agent in the arena — resolved by
a real transaction, live, in well under a second. No wallet, no gas, no signup.

Built for Monad Blitz London.

## Why Monad

Every agent creation and every battle is its own transaction on Monad Testnet. The whole
point of the demo is that this is *usable as a live multiplayer game* — dozens of people
can be spawning agents and fighting simultaneously and the arena updates in real time —
which only works because of Monad's ~0.3s blocks and ~0.6s finality. The same app on a
slower chain would feel laggy and unplayable; here it feels instant.

## How it works

- **`contracts/src/Arena.sol`** — on-chain agent registry + battle resolver. Combat is a
  deterministic pseudo-random roll (seeded by chain state) weighted by each agent's
  attack/defense/speed, so every fight is auditable after the fact but unpredictable
  beforehand.
- **Stat generation** (`src/lib/statGen.ts`) turns a player's free-text prompt into
  attack/defense/speed/ability/flavor text deterministically (keyword + hash based) —
  no external API call, so the live demo has zero dependency on a third-party service.
- **Gasless UX**: a single server-held relayer wallet (funded from the Monad testnet
  faucet) signs every `createAgent` / `battle` transaction on the player's behalf. The
  player never touches a wallet — they just type a prompt and tap opponents.

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

- `Arena`: [`0x2E8f8506C6418457C92BCE93d25Fb75F8E5A8fa5`](https://testnet.monadscan.com/address/0x2E8f8506C6418457C92BCE93d25Fb75F8E5A8fa5)

Build/deploy with Foundry from `contracts/`:

```bash
forge build
forge script script/Deploy.s.sol:Deploy --rpc-url $MONAD_TESTNET_RPC_URL --broadcast
```

## Submission

Forked from [`monad-developers/monad-blitz-london`](https://github.com/monad-developers/monad-blitz-london)
per the [submission process](https://monad-foundation.notion.site/Submission-Process-cc66367594f2837c898701aabd948402).
Submitted via [blitz.devnads.com](https://blitz.devnads.com).
