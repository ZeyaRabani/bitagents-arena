import { NextResponse } from "next/server";
import { fetchUsers } from "@/lib/bithumansActions";
import { startRoyale, royaleSnapshot } from "@/lib/gameState";

export async function POST() {
  try {
    if (royaleSnapshot().status === "running") {
      return NextResponse.json({ error: "a royale is already running" }, { status: 409 });
    }
    const users = await fetchUsers();
    await startRoyale(users);
    return NextResponse.json({ started: true, participantCount: users.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
