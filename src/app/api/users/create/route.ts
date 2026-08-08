import { NextResponse } from "next/server";
import { createUserOnChain } from "@/lib/bithumansActions";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name = String(body?.name ?? "").slice(0, 32);
    if (!name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const result = await createUserOnChain(name);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
