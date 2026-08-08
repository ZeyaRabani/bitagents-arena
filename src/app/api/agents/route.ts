import { NextResponse } from "next/server";
import { fetchAgents } from "@/lib/arenaActions";

export async function GET() {
  try {
    const agents = await fetchAgents();
    return NextResponse.json({ agents });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
