import { NextResponse } from "next/server";
import { royaleSnapshot } from "@/lib/gameState";

export async function GET() {
  return NextResponse.json({ royale: royaleSnapshot() });
}
