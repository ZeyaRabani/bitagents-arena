import { NextResponse } from "next/server";
import { submitAnswer } from "@/lib/gameState";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const matchId = String(body?.matchId ?? "");
    const userId = String(body?.userId ?? "");
    const choice = Number(body?.choice);
    if (!matchId || !userId || Number.isNaN(choice)) {
      return NextResponse.json({ error: "matchId, userId and choice are required" }, { status: 400 });
    }
    submitAnswer(matchId, userId, choice);
    return NextResponse.json({ submitted: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
