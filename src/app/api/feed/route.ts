import { NextResponse } from "next/server";
import { state } from "@/lib/gameState";

export async function GET() {
  return NextResponse.json({ feed: state.feed });
}
