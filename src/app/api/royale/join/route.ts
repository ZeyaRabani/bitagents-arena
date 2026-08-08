import { NextResponse } from "next/server";
import { joinRoyaleLobby, royaleSnapshot } from "@/lib/gameState";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userId = String(body?.userId ?? "");
    const name = String(body?.name ?? "");
    if (!userId || !name) {
      return NextResponse.json({ error: "userId and name are required" }, { status: 400 });
    }
    joinRoyaleLobby(userId, name);
    return NextResponse.json({ royale: royaleSnapshot() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
