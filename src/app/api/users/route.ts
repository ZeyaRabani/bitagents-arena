import { NextResponse } from "next/server";
import { fetchUsers } from "@/lib/bithumansActions";

export async function GET() {
  try {
    const users = await fetchUsers();
    return NextResponse.json({ users });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
