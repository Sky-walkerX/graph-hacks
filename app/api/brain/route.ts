import { type NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { answersToReask, GraphUnavailable, keystoneDecisions, knows } from "@/lib/graph/manifest";

// GET /api/brain?q=… (or ?chat=<conversation>) - what the notebook knows about a topic (or, with a "/"
// or a file extension in it, a file), and which agents know it; with no q,
// the decisions the most work rests on and the Ask answers built on pages
// since replaced. { available: false } when the graph can't be reached.
export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = request.nextUrl.searchParams.get("q")?.trim().slice(0, 200) ?? "";
  const chat = request.nextUrl.searchParams.get("chat")?.slice(0, 64);
  try {
    // One Ask conversation's answers that cite pages since replaced.
    if (chat) return NextResponse.json({ available: true, keystones: [], known: [], docs: [], reask: await answersToReask(userId, { chat }) });
    if (!q) {
      const [keystones, reask] = await Promise.all([keystoneDecisions(userId), answersToReask(userId)]);
      return NextResponse.json({ available: true, keystones, known: [], docs: [], reask });
    }
    const looksLikeFile = /\//.test(q) || /\.\w{1,5}$/.test(q);
    const { known, docs } = await knows(userId, looksLikeFile ? { file: q } : { topic: q });
    return NextResponse.json({ available: true, keystones: [], known, docs, reask: [] });
  } catch (e) {
    if (!(e instanceof GraphUnavailable)) console.error("Reading the graph failed", e);
    return NextResponse.json({ available: false, keystones: [], known: [], docs: [], reask: [] });
  }
}
