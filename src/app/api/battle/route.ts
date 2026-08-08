import { NextResponse } from "next/server";
import { battleOnChain } from "@/lib/arenaActions";

// Manual/debug battle trigger — the live app drives battles via the queue and
// battle-royale flows, but this stays handy for testing the contract directly.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const idA = String(body?.idA ?? "");
    const idB = String(body?.idB ?? "");
    if (!idA || !idB || idA === idB) {
      return NextResponse.json({ error: "idA and idB are required and must differ" }, { status: 400 });
    }
    const result = await battleOnChain(idA, idB);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
