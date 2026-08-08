import { NextResponse } from "next/server";
import { queueSnapshot, state } from "@/lib/gameState";

export async function GET() {
  return NextResponse.json({
    queue: queueSnapshot(),
    recentQueueBattles: state.feed.filter((f) => f.mode === "queue").slice(0, 10),
  });
}
