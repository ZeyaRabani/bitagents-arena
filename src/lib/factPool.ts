// Shared subject pool. Position in this array IS the on-chain fact id (bit index in the
// agent's uint32 knowledge bitmask), so don't reorder existing entries — only append.
// FACT_COUNT in Arena.sol must match this array's length.
//
// Each subject has a short display name (used for the pick/train grid and chips) plus a
// handful of sample questions used only for flavor when showing "the question was..." in
// a battle result — the contract only ever tracks the subject id, not which specific
// question, so these can be edited/expanded freely without touching the contract.

export interface Fact {
  id: number;
  q: string; // subject name, e.g. "History"
  a: string; // one-line description shown while picking
  sampleQuestions: string[];
}

export const FACT_POOL: Fact[] = [
  {
    id: 0,
    q: "History",
    a: "Wars, empires, and the people who shaped them",
    sampleQuestions: [
      "What year did Bitcoin's whitepaper release?",
      "What year did World War II end?",
      "Who was the first person to walk on the Moon?",
    ],
  },
  {
    id: 1,
    q: "Maths",
    a: "Arithmetic, geometry, and everything with numbers",
    sampleQuestions: ["What's 7 x 8?", "What's the square root of 64?", "What's the first prime number?"],
  },
  {
    id: 2,
    q: "Geography",
    a: "Countries, capitals, and continents",
    sampleQuestions: [
      "What's the capital of France?",
      "How many continents are there?",
      "What's the tallest mountain on Earth?",
    ],
  },
  {
    id: 3,
    q: "Science",
    a: "Physics, chemistry, and the natural world",
    sampleQuestions: [
      "What's the boiling point of water at sea level (C)?",
      "What's the chemical symbol for gold?",
      "What's the speed of light (approx, km/s)?",
    ],
  },
  {
    id: 4,
    q: "Monad & Crypto",
    a: "This chain, and the ecosystem around it",
    sampleQuestions: [
      "What's Monad's target block time?",
      "What database powers Monad's state?",
      "What does 'gwei' measure?",
    ],
  },
  {
    id: 5,
    q: "Pop Culture",
    a: "Movies, internet culture, and the extremely online",
    sampleQuestions: [
      "What does 'HODL' originally come from?",
      "What does 'gm' mean in crypto Twitter?",
      "What comes after 'to be or not to'?",
    ],
  },
  {
    id: 6,
    q: "Animals",
    a: "Creatures, great and small",
    sampleQuestions: [
      "How many legs does a spider have?",
      "What's the tallest animal on Earth?",
      "What do bees make?",
    ],
  },
  {
    id: 7,
    q: "Space",
    a: "Planets, stars, and everything above",
    sampleQuestions: [
      "What planet do we live on?",
      "How many planets are in our solar system?",
      "What's the closest star to Earth?",
    ],
  },
  {
    id: 8,
    q: "Food & Drink",
    a: "What we eat, and where it comes from",
    sampleQuestions: [
      "What color do you get mixing blue and yellow?",
      "What's honey made by?",
      "What grain is bread traditionally made from?",
    ],
  },
  {
    id: 9,
    q: "Sports",
    a: "Games, rules, and records",
    sampleQuestions: [
      "How many players are on a football (soccer) team?",
      "How often are the Summer Olympics held?",
      "How many minutes in a day?",
    ],
  },
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

/** Deterministic per-battle sample question so the same fight always shows the same
 *  question, but different fights on the same subject show variety. */
export function pickSampleQuestion(fact: Fact, seedStr: string): string {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) {
    h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
  }
  return fact.sampleQuestions[h % fact.sampleQuestions.length];
}

export const MAX_STARTING_FACTS = 5;
