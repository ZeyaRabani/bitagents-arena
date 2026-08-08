import { NextResponse } from "next/server";
import { queueSnapshot } from "@/lib/gameState";

export async function GET() {
  return NextResponse.json({ queue: queueSnapshot() });
}
