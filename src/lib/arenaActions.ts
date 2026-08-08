import { decodeEventLog, keccak256, toBytes } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { publicClient, getRelayerClient, arenaAbi, getArenaAddress, monadTestnet } from "./chain";
import { generateAgentFromPrompt } from "./statGen";
import { factsToBitmask, MAX_STARTING_FACTS } from "./factPool";

export interface OnChainAgent {
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
  lastFactTaught: number;
  createdAt: string;
  lastTrainedAt: string;
}

/// The exact bytes32 the contract uses as this agent's permanent identity — it's
/// keccak256(name), the same hash that binds the name in `nameToId`, so the name and the
/// hash are always mutually verifiable.
export function nameHashOf(name: string): `0x${string}` {
  return keccak256(toBytes(name));
}

// The public Monad testnet RPC is rate-limited (15 req/sec). Every open browser tab
// polls /api/agents on its own timer, and the matchmaker polls independently too — with
// more than a handful of concurrent players that blows through the limit and silently
// breaks matchmaking (fetchAgents throws, the tick aborts, nobody gets paired). Cache
// briefly and de-dupe concurrent callers onto a single in-flight request.
const AGENTS_CACHE_TTL_MS = 2500;
let agentsCache: { at: number; data: OnChainAgent[] } | null = null;
let agentsInFlight: Promise<OnChainAgent[]> | null = null;

async function withRpcRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 300));
    return withRpcRetry(fn, retries - 1);
  }
}

async function fetchAgentsUncached(): Promise<OnChainAgent[]> {
  const address = getArenaAddress();
  const total = await withRpcRetry(() =>
    publicClient.readContract({
      address,
      abi: arenaAbi,
      functionName: "totalAgents",
    })
  );
  const agents = await withRpcRetry(() =>
    publicClient.readContract({
      address,
      abi: arenaAbi,
      functionName: "getAgents",
      args: [BigInt(0), total],
    })
  );
  return agents.map((a) => ({
    id: a.id.toString(),
    owner: a.owner,
    name: a.name,
    ability: a.ability,
    flavor: a.flavor,
    attack: a.attack,
    defense: a.defense,
    speed: a.speed,
    wins: a.wins,
    losses: a.losses,
    rating: a.rating,
    knowledge: a.knowledge,
    knowledgeCap: a.knowledgeCap,
    lastFactTaught: a.lastFactTaught,
    createdAt: a.createdAt.toString(),
    lastTrainedAt: a.lastTrainedAt.toString(),
  }));
}

export async function fetchAgents(): Promise<OnChainAgent[]> {
  if (agentsCache && Date.now() - agentsCache.at < AGENTS_CACHE_TTL_MS) {
    return agentsCache.data;
  }
  if (agentsInFlight) return agentsInFlight;

  agentsInFlight = fetchAgentsUncached()
    .then((data) => {
      agentsCache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      agentsInFlight = null;
    });

  return agentsInFlight;
}

/** Bypass the cache immediately after a write so the caller sees its own effect. */
export function invalidateAgentsCache() {
  agentsCache = null;
}

export async function isNameTaken(name: string): Promise<boolean> {
  return publicClient.readContract({
    address: getArenaAddress(),
    abi: arenaAbi,
    functionName: "isNameTaken",
    args: [name],
  });
}

export async function createAgentOnChain(name: string, prompt: string, factIds: number[]) {
  const cleanName = name.trim().slice(0, 32);
  if (!cleanName) throw new Error("name is required");
  if (await isNameTaken(cleanName)) throw new Error("that name is already taken");

  const boundedFacts = factIds.slice(0, MAX_STARTING_FACTS);
  const knowledge = factsToBitmask(boundedFacts);
  const stats = generateAgentFromPrompt(prompt || cleanName);

  const ownerAccount = privateKeyToAccount(generatePrivateKey());
  const relayer = getRelayerClient();
  const address = getArenaAddress();

  const hash = await relayer.writeContract({
    address,
    abi: arenaAbi,
    functionName: "createAgent",
    args: [
      ownerAccount.address,
      cleanName,
      stats.ability,
      stats.flavor,
      stats.attack,
      stats.defense,
      stats.speed,
      knowledge,
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  let agentId: string | null = null;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: arenaAbi, data: log.data, topics: log.topics, eventName: "AgentCreated" });
      agentId = decoded.args.id.toString();
      break;
    } catch {
      // not our event
    }
  }

  invalidateAgentsCache();
  return {
    agentId,
    owner: ownerAccount.address,
    nameHash: nameHashOf(cleanName),
    txHash: hash,
    explorerUrl: `${monadTestnet.blockExplorers.default.url}/tx/${hash}`,
    stats,
    knowledge,
  };
}

export async function trainAgentOnChain(agentId: string, factId: number) {
  const relayer = getRelayerClient();
  const address = getArenaAddress();
  const hash = await relayer.writeContract({
    address,
    abi: arenaAbi,
    functionName: "train",
    args: [BigInt(agentId), factId],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  invalidateAgentsCache();
  return { txHash: hash, explorerUrl: `${monadTestnet.blockExplorers.default.url}/tx/${hash}` };
}

export interface BattleOutcome {
  winnerId: string;
  loserId: string;
  factId: number;
  decidedByKnowledge: boolean;
  winnerRoll: string;
  loserRoll: string;
  ratingDelta: string;
  winnerRatingAfter: number;
  loserRatingAfter: number;
  txHash: string;
  explorerUrl: string;
}

export async function battleOnChain(idA: string, idB: string): Promise<BattleOutcome> {
  const relayer = getRelayerClient();
  const address = getArenaAddress();
  const hash = await relayer.writeContract({
    address,
    abi: arenaAbi,
    functionName: "battle",
    args: [BigInt(idA), BigInt(idB)],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  invalidateAgentsCache();

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: arenaAbi, data: log.data, topics: log.topics, eventName: "BattleResolved" });
      return {
        winnerId: decoded.args.winnerId.toString(),
        loserId: decoded.args.loserId.toString(),
        factId: decoded.args.factId,
        decidedByKnowledge: decoded.args.decidedByKnowledge,
        winnerRoll: decoded.args.winnerRoll.toString(),
        loserRoll: decoded.args.loserRoll.toString(),
        ratingDelta: decoded.args.ratingDelta.toString(),
        winnerRatingAfter: decoded.args.winnerRatingAfter,
        loserRatingAfter: decoded.args.loserRatingAfter,
        txHash: hash,
        explorerUrl: `${monadTestnet.blockExplorers.default.url}/tx/${hash}`,
      };
    } catch {
      // not our event
    }
  }
  throw new Error("BattleResolved event not found in receipt");
}
