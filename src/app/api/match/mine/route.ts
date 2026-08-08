import { NextResponse } from "next/server";
import { getPendingMatchForUser } from "@/lib/gameState";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const m = getPendingMatchForUser(userId);
  if (!m) {
    return NextResponse.json({ match: null });
  }

  const isA = m.idA === userId;
  const opponentName = isA ? m.nameB : m.nameA;
  const myAnswer = isA ? m.answerA : m.answerB;
  const opponentAnswered = isA ? m.answerB !== null : m.answerA !== null;

  return NextResponse.json({
    match: {
      id: m.id,
      mode: m.mode,
      opponentName,
      question: { q: m.question.q, options: m.question.options },
      myAnswer,
      opponentAnswered,
      resolved: m.resolved,
      outcome: m.resolved
        ? {
            ...m.outcome,
            iWon: m.outcome && "winnerId" in m.outcome ? m.outcome.winnerId === userId : null,
            correctIndex: m.question.correctIndex,
          }
        : null,
      createdAt: m.createdAt,
    },
  });
}
