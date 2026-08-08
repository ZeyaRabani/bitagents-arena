import { decodeEventLog, keccak256, toBytes } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { publicClient, getRelayerClient, getRelayerAccount, bithumansAbi, getBitHumansAddress, monadTestnet } from "./chain";

export interface OnChainUser {
  id: string;
  owner: string;
  name: string;
  balance: number; // cents
  wins: number;
  losses: number;
  createdAt: string;
  lastDripAt: string;
}

export function nameHashOf(name: string): `0x${string}` {
  return keccak256(toBytes(name));
}

// The relayer is a single account with a single nonce sequence. Simply queuing writes
// one-at-a-time isn't enough on its own: cloud RPC providers (Alchemy included) load-
// balance across backend nodes, and a node's view of "pending" nonces can lag behind a
// transaction that was just accepted by a different node — so even a strictly serial
// caller can get back a stale nonce and collide ("existing transaction had higher
// priority"). Track the nonce ourselves instead of asking the RPC for it each time, and
// only fall back to asking on the very first send or after an error (in case a
// transaction never actually landed and we need to resync).
let writeQueue: Promise<unknown> = Promise.resolve();
let cachedNonce: number | null = null;

function serializedSend(fn: (nonce: number) => Promise<`0x${string}`>): Promise<`0x${string}`> {
  const run = writeQueue.then(async () => {
    if (cachedNonce === null) {
      cachedNonce = await publicClient.getTransactionCount({
        address: getRelayerAccount().address,
        blockTag: "pending",
      });
    }
    const nonce = cachedNonce;
    try {
      const hash = await fn(nonce);
      cachedNonce = nonce + 1;
      return hash;
    } catch (err) {
      // Something about this nonce didn't land (reverted, dropped, RPC disagreed) —
      // don't keep incrementing from a possibly-wrong base; refetch next time.
      cachedNonce = null;
      throw err;
    }
  });
  writeQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// Same rate-limit mitigation as the BitAgents app: the public Monad RPC caps at
// 15 req/sec, and every open tab plus the matchmaker polling independently blows
// through that fast. Cache briefly, de-dupe concurrent callers, and guard cache writes
// with an epoch so a stale in-flight response can never clobber a fresher invalidation.
const USERS_CACHE_TTL_MS = 4000;
let usersCache: { at: number; data: OnChainUser[] } | null = null;
let usersInFlight: Promise<OnChainUser[]> | null = null;
let cacheEpoch = 0;

async function withRpcRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 500));
    return withRpcRetry(fn, retries - 1);
  }
}

async function fetchUsersUncached(): Promise<OnChainUser[]> {
  const address = getBitHumansAddress();
  const total = await withRpcRetry(() =>
    publicClient.readContract({ address, abi: bithumansAbi, functionName: "totalUsers" })
  );
  const users = await withRpcRetry(() =>
    publicClient.readContract({
      address,
      abi: bithumansAbi,
      functionName: "getUsers",
      args: [BigInt(0), total],
    })
  );
  return users.map((u) => ({
    id: u.id.toString(),
    owner: u.owner,
    name: u.name,
    balance: u.balance,
    wins: u.wins,
    losses: u.losses,
    createdAt: u.createdAt.toString(),
    lastDripAt: u.lastDripAt.toString(),
  }));
}

export async function fetchUsers(): Promise<OnChainUser[]> {
  if (usersCache && Date.now() - usersCache.at < USERS_CACHE_TTL_MS) {
    return usersCache.data;
  }
  if (usersInFlight) return usersInFlight;

  const epochAtStart = cacheEpoch;
  usersInFlight = fetchUsersUncached()
    .then((data) => {
      if (epochAtStart === cacheEpoch) {
        usersCache = { at: Date.now(), data };
      }
      return data;
    })
    .finally(() => {
      usersInFlight = null;
    });

  return usersInFlight;
}

export function invalidateUsersCache() {
  usersCache = null;
  cacheEpoch++;
}

export async function isNameTaken(name: string): Promise<boolean> {
  return withRpcRetry(() =>
    publicClient.readContract({
      address: getBitHumansAddress(),
      abi: bithumansAbi,
      functionName: "isNameTaken",
      args: [name],
    })
  );
}

export async function createUserOnChain(name: string) {
  const cleanName = name.trim().slice(0, 32);
  if (!cleanName) throw new Error("name is required");
  if (await isNameTaken(cleanName)) throw new Error("that name is already taken");

  const ownerAccount = privateKeyToAccount(generatePrivateKey());
  const relayer = getRelayerClient();
  const address = getBitHumansAddress();

  const hash = await serializedSend((nonce) =>
    relayer.writeContract({
      address,
      abi: bithumansAbi,
      functionName: "createUser",
      args: [ownerAccount.address, cleanName],
      nonce,
    })
  );
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  let userId: string | null = null;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: bithumansAbi, data: log.data, topics: log.topics, eventName: "UserCreated" });
      userId = decoded.args.id.toString();
      break;
    } catch {
      // not our event
    }
  }

  invalidateUsersCache();
  return {
    userId,
    owner: ownerAccount.address,
    nameHash: nameHashOf(cleanName),
    txHash: hash,
    explorerUrl: `${monadTestnet.blockExplorers.default.url}/tx/${hash}`,
  };
}

export interface MatchOutcome {
  winnerId: string;
  loserId: string;
  questionId: number;
  decidedByAnswer: boolean;
  winnerAnswerMs: number;
  loserAnswerMs: number;
  wager: number;
  winnerBalanceAfter: number;
  loserBalanceAfter: number;
  txHash: string;
  explorerUrl: string;
}

export async function resolveWagerMatchOnChain(
  idA: string,
  idB: string,
  questionId: number,
  correctIndex: number,
  answerA: number,
  answerB: number,
  answerMsA: number,
  answerMsB: number
): Promise<MatchOutcome> {
  const relayer = getRelayerClient();
  const address = getBitHumansAddress();
  const hash = await serializedSend((nonce) =>
    relayer.writeContract({
      address,
      abi: bithumansAbi,
      functionName: "resolveWagerMatch",
      args: [BigInt(idA), BigInt(idB), questionId, correctIndex, answerA, answerB, answerMsA, answerMsB],
      nonce,
    })
  );
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  invalidateUsersCache();

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: bithumansAbi, data: log.data, topics: log.topics, eventName: "MatchResolved" });
      return {
        winnerId: decoded.args.winnerId.toString(),
        loserId: decoded.args.loserId.toString(),
        questionId: decoded.args.questionId,
        decidedByAnswer: decoded.args.decidedByAnswer,
        winnerAnswerMs: decoded.args.winnerAnswerMs,
        loserAnswerMs: decoded.args.loserAnswerMs,
        wager: decoded.args.wager,
        winnerBalanceAfter: decoded.args.winnerBalanceAfter,
        loserBalanceAfter: decoded.args.loserBalanceAfter,
        txHash: hash,
        explorerUrl: `${monadTestnet.blockExplorers.default.url}/tx/${hash}`,
      };
    } catch {
      // not our event
    }
  }
  throw new Error("MatchResolved event not found in receipt");
}

export interface RoyaleRoundOutcome {
  winnerId: string;
  loserId: string;
  questionId: number;
  decidedByAnswer: boolean;
  winnerAnswerMs: number;
  loserAnswerMs: number;
  txHash: string;
  explorerUrl: string;
}

export async function resolveRoyaleRoundOnChain(
  idA: string,
  idB: string,
  questionId: number,
  correctIndex: number,
  answerA: number,
  answerB: number,
  answerMsA: number,
  answerMsB: number
): Promise<RoyaleRoundOutcome> {
  const relayer = getRelayerClient();
  const address = getBitHumansAddress();
  const hash = await serializedSend((nonce) =>
    relayer.writeContract({
      address,
      abi: bithumansAbi,
      functionName: "resolveRoyaleRound",
      args: [BigInt(idA), BigInt(idB), questionId, correctIndex, answerA, answerB, answerMsA, answerMsB],
      nonce,
    })
  );
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: bithumansAbi, data: log.data, topics: log.topics, eventName: "RoyaleRoundResolved" });
      return {
        winnerId: decoded.args.winnerId.toString(),
        loserId: decoded.args.loserId.toString(),
        questionId: decoded.args.questionId,
        decidedByAnswer: decoded.args.decidedByAnswer,
        winnerAnswerMs: decoded.args.winnerAnswerMs,
        loserAnswerMs: decoded.args.loserAnswerMs,
        txHash: hash,
        explorerUrl: `${monadTestnet.blockExplorers.default.url}/tx/${hash}`,
      };
    } catch {
      // not our event
    }
  }
  throw new Error("RoyaleRoundResolved event not found in receipt");
}

export async function startRoyaleEntriesOnChain(ids: string[]): Promise<number> {
  const relayer = getRelayerClient();
  const address = getBitHumansAddress();
  const hash = await serializedSend((nonce) =>
    relayer.writeContract({
      address,
      abi: bithumansAbi,
      functionName: "startRoyaleEntries",
      args: [ids.map((id) => BigInt(id))],
      nonce,
    })
  );
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  invalidateUsersCache();

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: bithumansAbi, data: log.data, topics: log.topics, eventName: "RoyaleEntriesLocked" });
      return decoded.args.potAmount;
    } catch {
      // not our event
    }
  }
  throw new Error("RoyaleEntriesLocked event not found in receipt");
}

export async function payRoyaleChampionOnChain(championId: string, potAmount: number) {
  const relayer = getRelayerClient();
  const address = getBitHumansAddress();
  const hash = await serializedSend((nonce) =>
    relayer.writeContract({
      address,
      abi: bithumansAbi,
      functionName: "payRoyaleChampion",
      args: [BigInt(championId), potAmount],
      nonce,
    })
  );
  await publicClient.waitForTransactionReceipt({ hash });
  invalidateUsersCache();
  return { txHash: hash, explorerUrl: `${monadTestnet.blockExplorers.default.url}/tx/${hash}` };
}
