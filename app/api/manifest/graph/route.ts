import { type NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { GraphUnavailable, viewReceipt } from "@/lib/graph/manifest";

// GET /api/manifest/graph?receipt=… - the nodes and relationships behind one
// receipt, as the graph returns them, for drawing.
export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = request.nextUrl.searchParams.get("receipt") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Give a receipt id" }, { status: 400 });
  try {
    const view = await viewReceipt(userId, id);
    return view ? NextResponse.json(view) : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    if (!(e instanceof GraphUnavailable)) console.error("Reading a receipt's graph failed", e);
    return NextResponse.json({ error: "The graph can't be reached" }, { status: 503 });
  }
}
