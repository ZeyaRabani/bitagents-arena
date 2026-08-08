import { NextResponse } from "next/server";
import { decodeEventLog } from "viem";
import { publicClient, getRelayerClient, arenaAbi, getArenaAddress, monadTestnet } from "@/lib/chain";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const idA = BigInt(body?.idA ?? 0);
    const idB = BigInt(body?.idB ?? 0);
    if (!idA || !idB || idA === idB) {
      return NextResponse.json({ error: "idA and idB are required and must differ" }, { status: 400 });
    }

    const relayer = getRelayerClient();
    const address = getArenaAddress();

    const hash = await relayer.writeContract({
      address,
      abi: arenaAbi,
      functionName: "battle",
      args: [idA, idB],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    let result: { winnerId: string; loserId: string; winnerRoll: string; loserRoll: string } | null = null;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: arenaAbi, data: log.data, topics: log.topics, eventName: "BattleResolved" });
        result = {
          winnerId: decoded.args.winnerId.toString(),
          loserId: decoded.args.loserId.toString(),
          winnerRoll: decoded.args.winnerRoll.toString(),
          loserRoll: decoded.args.loserRoll.toString(),
        };
        break;
      } catch {
        // not the event we're looking for
      }
    }

    return NextResponse.json({
      result,
      txHash: hash,
      explorerUrl: `${monadTestnet.blockExplorers.default.url}/tx/${hash}`,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
