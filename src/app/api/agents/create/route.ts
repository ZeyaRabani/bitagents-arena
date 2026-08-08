import { NextResponse } from "next/server";
import { createAgentOnChain } from "@/lib/arenaActions";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name = String(body?.name ?? "").slice(0, 32);
    const prompt = String(body?.prompt ?? "").slice(0, 200);
    const factIds: number[] = Array.isArray(body?.factIds) ? body.factIds.map(Number) : [];

    if (!name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const result = await createAgentOnChain(name, prompt, factIds);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
