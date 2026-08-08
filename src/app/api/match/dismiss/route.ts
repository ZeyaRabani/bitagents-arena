import { NextResponse } from "next/server";
import { dismissMatch } from "@/lib/gameState";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const matchId = String(body?.matchId ?? "");
    if (!matchId) {
      return NextResponse.json({ error: "matchId is required" }, { status: 400 });
    }
    dismissMatch(matchId);
    return NextResponse.json({ dismissed: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
