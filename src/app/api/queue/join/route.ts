import { NextResponse } from "next/server";
import { joinQueue, startMatchmaker } from "@/lib/gameState";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const agentId = String(body?.agentId ?? "");
    const name = String(body?.name ?? "");
    if (!agentId || !name) {
      return NextResponse.json({ error: "agentId and name are required" }, { status: 400 });
    }
    startMatchmaker();
    joinQueue(agentId, name);
    return NextResponse.json({ joined: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
