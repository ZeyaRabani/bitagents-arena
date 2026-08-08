import { NextResponse } from "next/server";
import { joinQueue, startMatchmaker } from "@/lib/gameState";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userId = String(body?.userId ?? "");
    const name = String(body?.name ?? "");
    if (!userId || !name) {
      return NextResponse.json({ error: "userId and name are required" }, { status: 400 });
    }
    startMatchmaker();
    joinQueue(userId, name);
    return NextResponse.json({ joined: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
