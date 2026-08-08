import { NextResponse } from "next/server";
import { leaveQueue } from "@/lib/gameState";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const agentId = String(body?.agentId ?? "");
    if (!agentId) {
      return NextResponse.json({ error: "agentId is required" }, { status: 400 });
    }
    leaveQueue(agentId);
    return NextResponse.json({ left: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
