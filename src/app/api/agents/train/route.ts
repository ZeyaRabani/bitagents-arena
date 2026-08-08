import { NextResponse } from "next/server";
import { trainAgentOnChain } from "@/lib/arenaActions";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const agentId = String(body?.agentId ?? "");
    const factId = Number(body?.factId);
    if (!agentId || Number.isNaN(factId)) {
      return NextResponse.json({ error: "agentId and factId are required" }, { status: 400 });
    }
    const result = await trainAgentOnChain(agentId, factId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
