import { type NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { GraphUnavailable, listManifests } from "@/lib/graph/manifest";

// GET /api/manifest - what each agent working from a baton was handed, and
// what has changed since. { available: false } when the graph can't be reached.
export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ available: true, manifests: await listManifests(userId) });
  } catch (e) {
    if (!(e instanceof GraphUnavailable)) console.error("Listing manifests failed", e);
    return NextResponse.json({ available: false, manifests: [] });
  }
}
