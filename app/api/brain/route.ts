import { type NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { GraphUnavailable, keystoneDecisions, knows } from "@/lib/graph/manifest";

// GET /api/brain?q=… - what the notebook knows about a topic (or, with a "/"
// or a file extension in it, a file), and which agents know it; with no q,
// the decisions the most work rests on. { available: false } when the graph
// can't be reached.
export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = request.nextUrl.searchParams.get("q")?.trim().slice(0, 200) ?? "";
  try {
    if (!q) return NextResponse.json({ available: true, keystones: await keystoneDecisions(userId), known: [] });
    const looksLikeFile = /\//.test(q) || /\.\w{1,5}$/.test(q);
    const known = await knows(userId, looksLikeFile ? { file: q } : { topic: q });
    return NextResponse.json({ available: true, keystones: [], known });
  } catch (e) {
    if (!(e instanceof GraphUnavailable)) console.error("Reading the graph failed", e);
    return NextResponse.json({ available: false, keystones: [], known: [] });
  }
}
