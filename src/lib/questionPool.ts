// Shared multiple-choice question bank. `id` is just a display/record id (stored in the
// on-chain event for reference) — the contract never validates which question was
// "really" asked, it trusts whatever questionId/correctIndex the relayer supplies, same
// trust boundary as everything else the relayer already does in this app.

export interface Question {
  id: number;
  q: string;
  options: [string, string, string, string];
  correctIndex: number;
}

export const QUESTION_POOL: Question[] = [
  {
    id: 0,
    q: "What's Monad's target block time?",
    options: ["~0.3 seconds", "~2 seconds", "~12 seconds", "~1 minute"],
    correctIndex: 0,
  },
  {
    id: 1,
    q: "What's Monad's approximate finality time?",
    options: ["~0.6 seconds", "~6 seconds", "~1 minute", "~13 minutes"],
    correctIndex: 0,
  },
  {
    id: 2,
    q: "Is Monad EVM bytecode compatible?",
    options: ["Yes, 100%", "No, it's a new VM", "Only for reads", "Only via a bridge"],
    correctIndex: 0,
  },
  {
    id: 3,
    q: "What database powers Monad's state?",
    options: ["MonadDB", "RocksDB", "LevelDB", "Postgres"],
    correctIndex: 0,
  },
  {
    id: 4,
    q: "What's Monad's consensus protocol called?",
    options: ["MonadBFT", "Tendermint", "Proof of History", "Nakamoto Consensus"],
    correctIndex: 0,
  },
  {
    id: 5,
    q: "What's Monad's block propagation protocol called?",
    options: ["RaptorCast", "Gossipsub", "Kademlia", "Turbine"],
    correctIndex: 0,
  },
  {
    id: 6,
    q: "What technique lets Monad run independent transactions in parallel?",
    options: ["Optimistic parallel execution", "Sharding", "Rollups", "Sidechains"],
    correctIndex: 0,
  },
  {
    id: 7,
    q: "What's the max contract size on Monad, roughly?",
    options: ["256 KB", "24 KB", "1 MB", "No limit"],
    correctIndex: 0,
  },
  {
    id: 8,
    q: "What does 'gwei' measure in EVM chains?",
    options: ["Gas price", "Wallet balance", "Block size", "Validator count"],
    correctIndex: 0,
  },
  {
    id: 9,
    q: "What does 'HODL' originally come from?",
    options: ["A misspelling of 'hold'", "An acronym for 'hold on dear life'", "A Satoshi quote", "A Vitalik tweet"],
    correctIndex: 0,
  },
  {
    id: 10,
    q: "What year did Bitcoin's whitepaper release?",
    options: ["2008", "2001", "2013", "2015"],
    correctIndex: 0,
  },
  {
    id: 11,
    q: "What does 'gm' mean in crypto Twitter?",
    options: ["Good morning", "Gas metric", "General market", "Genesis mint"],
    correctIndex: 0,
  },
  {
    id: 12,
    q: "What's the opposite of 'bullish'?",
    options: ["Bearish", "Neutral", "Hawkish", "Dovish"],
    correctIndex: 0,
  },
  {
    id: 13,
    q: "What does an AMM stand for in DeFi?",
    options: ["Automated Market Maker", "Asset Management Model", "Algorithmic Money Mint", "Applied Mining Machine"],
    correctIndex: 0,
  },
  {
    id: 14,
    q: "What does 'gas' pay for on an EVM chain?",
    options: ["Computation and storage costs", "Validator salaries only", "Token listing fees", "Wallet creation"],
    correctIndex: 0,
  },
  {
    id: 15,
    q: "What's a 'testnet' for?",
    options: ["Testing with fake tokens, no real value", "The fastest real-money network", "A backup mainnet", "A private company chain"],
    correctIndex: 0,
  },
  {
    id: 16,
    q: "What does an ERC-20 token standard define?",
    options: ["A common interface for fungible tokens", "A consensus algorithm", "A wallet format", "A gas fee schedule"],
    correctIndex: 0,
  },
  {
    id: 17,
    q: "What's a 'validator' responsible for?",
    options: ["Proposing and confirming blocks", "Writing smart contracts", "Setting gas prices", "Running the block explorer"],
    correctIndex: 0,
  },
  {
    id: 18,
    q: "What does 'DYOR' mean?",
    options: ["Do your own research", "Deploy your own rollup", "Double your only reserve", "Delay your order"],
    correctIndex: 0,
  },
  {
    id: 19,
    q: "What's a smart contract?",
    options: ["Self-executing code stored on a blockchain", "A legal PDF stored on IPFS", "A validator's employment agreement", "A wallet's private key"],
    correctIndex: 0,
  },
];

export const QUESTION_COUNT = QUESTION_POOL.length;

export function pickRandomQuestion(): Question {
  return QUESTION_POOL[Math.floor(Math.random() * QUESTION_COUNT)];
}
