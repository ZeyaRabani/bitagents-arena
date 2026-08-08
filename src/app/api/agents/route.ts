import { NextResponse } from "next/server";
import { publicClient, arenaAbi, getArenaAddress } from "@/lib/chain";

export async function GET() {
  try {
    const total = await publicClient.readContract({
      address: getArenaAddress(),
      abi: arenaAbi,
      functionName: "totalAgents",
    });

    const agents = await publicClient.readContract({
      address: getArenaAddress(),
      abi: arenaAbi,
      functionName: "getAgents",
      args: [0n, total],
    });

    const serializable = agents.map((a) => ({
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
      createdAt: a.createdAt.toString(),
    }));

    return NextResponse.json({ agents: serializable });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
