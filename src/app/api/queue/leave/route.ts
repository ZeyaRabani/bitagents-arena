import { NextResponse } from "next/server";
import { leaveQueue } from "@/lib/gameState";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userId = String(body?.userId ?? "");
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }
    leaveQueue(userId);
    return NextResponse.json({ left: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
