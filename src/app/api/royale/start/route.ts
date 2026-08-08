import { NextResponse } from "next/server";
import { openRoyaleLobby, royaleSnapshot } from "@/lib/gameState";

export async function POST() {
  try {
    openRoyaleLobby();
    return NextResponse.json({ royale: royaleSnapshot() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
