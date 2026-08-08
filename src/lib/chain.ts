import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arenaAbi } from "./arenaAbi";

export const monadTestnet = defineChain({
  id: Number(process.env.MONAD_TESTNET_CHAIN_ID ?? 10143),
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.MONAD_TESTNET_RPC_URL ?? "https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "MonadScan", url: "https://testnet.monadscan.com" },
  },
  testnet: true,
});

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(),
});

export function getRelayerAccount() {
  const pk = process.env.RELAYER_PRIVATE_KEY;
  if (!pk) throw new Error("RELAYER_PRIVATE_KEY not set");
  return privateKeyToAccount(pk as `0x${string}`);
}

export function getRelayerClient() {
  return createWalletClient({
    account: getRelayerAccount(),
    chain: monadTestnet,
    transport: http(),
  });
}

export function getArenaAddress(): `0x${string}` {
  const addr = process.env.NEXT_PUBLIC_ARENA_CONTRACT_ADDRESS;
  if (!addr) throw new Error("NEXT_PUBLIC_ARENA_CONTRACT_ADDRESS not set");
  return addr as `0x${string}`;
}

export { arenaAbi };
