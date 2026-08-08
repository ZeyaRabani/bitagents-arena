import { NextResponse } from "next/server";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodeEventLog } from "viem";
import { publicClient, getRelayerClient, arenaAbi, getArenaAddress, monadTestnet } from "@/lib/chain";
import { generateAgentFromPrompt } from "@/lib/statGen";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const prompt = String(body?.prompt ?? "").slice(0, 200);
    if (!prompt.trim()) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const stats = generateAgentFromPrompt(prompt);

    // Ephemeral "owner" identity for this agent — purely for on-chain provenance/flavor.
    // No funds needed on it; the relayer pays all gas.
    const ownerAccount = privateKeyToAccount(generatePrivateKey());

    const relayer = getRelayerClient();
    const address = getArenaAddress();

    const hash = await relayer.writeContract({
      address,
      abi: arenaAbi,
      functionName: "createAgent",
      args: [ownerAccount.address, stats.name, stats.ability, stats.flavor, stats.attack, stats.defense, stats.speed],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    let agentId: string | null = null;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: arenaAbi, data: log.data, topics: log.topics, eventName: "AgentCreated" });
        agentId = decoded.args.id.toString();
        break;
      } catch {
        // not the event we're looking for
      }
    }

    return NextResponse.json({
      agentId,
      owner: ownerAccount.address,
      txHash: hash,
      explorerUrl: `${monadTestnet.blockExplorers.default.url}/tx/${hash}`,
      stats,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
