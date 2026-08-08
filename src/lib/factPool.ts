// Shared knowledge pool. Position in this array IS the on-chain fact id (bit index
// in the agent's uint32 knowledge bitmask), so don't reorder existing entries —
// only append. FACT_COUNT in Arena.sol must match this array's length.

export interface Fact {
  id: number;
  q: string;
  a: string;
}

export const FACT_POOL: Fact[] = [
  { id: 0, q: "What's Monad's target block time?", a: "~0.3 seconds" },
  { id: 1, q: "What's Monad's finality time?", a: "~0.6 seconds" },
  { id: 2, q: "Is Monad EVM bytecode compatible?", a: "Yes, 100%" },
  { id: 3, q: "What database powers Monad's state?", a: "MonadDB" },
  { id: 4, q: "What's Monad's consensus protocol called?", a: "MonadBFT" },
  { id: 5, q: "What's the block propagation protocol called?", a: "RaptorCast" },
  { id: 6, q: "What does BitAgents Arena run on?", a: "Monad Testnet" },
  { id: 7, q: "What's the loneliest number?", a: "1" },
  { id: 8, q: "What comes after 'to be or not to'?", a: "be" },
  { id: 9, q: "What's the boiling point of water at sea level (C)?", a: "100°C" },
  { id: 10, q: "How many sides does a hexagon have?", a: "6" },
  { id: 11, q: "What's the first prime number?", a: "2" },
  { id: 12, q: "What planet do we live on?", a: "Earth" },
  { id: 13, q: "What's 7 x 8?", a: "56" },
  { id: 14, q: "What does 'HODL' originally come from?", a: "A misspelling of 'hold'" },
  { id: 15, q: "What color do you get mixing blue and yellow?", a: "Green" },
  { id: 16, q: "What's the speed of light (approx, km/s)?", a: "300,000 km/s" },
  { id: 17, q: "How many legs does a spider have?", a: "8" },
  { id: 18, q: "What's the capital of France?", a: "Paris" },
  { id: 19, q: "What does 'gwei' measure?", a: "Gas price (a denomination of ETH)" },
  { id: 20, q: "What's a 'zorblex'?", a: "Whatever this agent's trainer decided it means" },
  { id: 21, q: "What's the freezing point of water (C)?", a: "0°C" },
  { id: 22, q: "How many continents are there?", a: "7" },
  { id: 23, q: "What's the square root of 64?", a: "8" },
  { id: 24, q: "What do bees make?", a: "Honey" },
  { id: 25, q: "What's the tallest animal on Earth?", a: "Giraffe" },
  { id: 26, q: "What does 'gm' mean in crypto Twitter?", a: "Good morning" },
  { id: 27, q: "How many minutes in a day?", a: "1,440" },
  { id: 28, q: "What's the chemical symbol for gold?", a: "Au" },
  { id: 29, q: "What year did Bitcoin's whitepaper release?", a: "2008" },
  { id: 30, q: "What's the opposite of 'bullish'?", a: "Bearish" },
  { id: 31, q: "Who won this hackathon?", a: "Ask the voters" },
];

export const FACT_COUNT = FACT_POOL.length;

export function factsToBitmask(factIds: number[]): number {
  let mask = 0;
  for (const id of factIds) {
    if (id < 0 || id >= FACT_COUNT) continue;
    mask |= 1 << id;
  }
  return mask >>> 0;
}

export function bitmaskToFacts(mask: number): Fact[] {
  const out: Fact[] = [];
  for (let i = 0; i < FACT_COUNT; i++) {
    if ((mask >>> i) & 1) out.push(FACT_POOL[i]);
  }
  return out;
}

export const MAX_STARTING_FACTS = 5;
