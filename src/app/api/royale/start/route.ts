import { NextResponse } from "next/server";
import { fetchAgents } from "@/lib/arenaActions";
import { startRoyale, royaleSnapshot } from "@/lib/gameState";

export async function POST() {
  try {
    if (royaleSnapshot().status === "running") {
      return NextResponse.json({ error: "a royale is already running" }, { status: 409 });
    }
    const agents = await fetchAgents();
    await startRoyale(agents);
    return NextResponse.json({ started: true, participantCount: agents.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
