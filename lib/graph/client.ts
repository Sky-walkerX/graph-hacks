import { FalkorDB, type Graph } from "falkordb";

// The FalkorDB connection, and one graph per account. The graph holds what
// the notebook's tables can't answer by themselves: which pages replace which
// once witnessed, what a task or a note depends on, and exactly what each
// agent was given when it picked work up (lib/graph/receipts.ts).
//
// A graph's name comes from the signed-in account, never from what an agent
// sends, so one account's agents can't reach another's graph.

type Conn = { db: Promise<FalkorDB> };
const cache = globalThis as unknown as { falkor?: Conn };

/** Whether this instance has a graph at all (FALKORDB_URL is set). */
export const graphConfigured = () => Boolean(process.env.FALKORDB_URL);

function connect(): Promise<FalkorDB> {
  if (!cache.falkor) {
    const db = FalkorDB.connect({ url: process.env.FALKORDB_URL });
    // A failed connect is dropped, so the next call tries again.
    db.catch(() => (cache.falkor = undefined));
    cache.falkor = { db };
  }
  return cache.falkor.db;
}

/** The graph's name for an account. Ids are uuids or cuids; anything else is dropped. */
export const graphName = (userId: string) => `lockin_${userId.replace(/[^A-Za-z0-9_-]/g, "")}`;

const indexed = new Set<string>();

// Lookups are by id (and a file by its repo and path); everything else is a walk.
const INDEXES = [
  "CREATE INDEX FOR (n:Note) ON (n.id)",
  "CREATE INDEX FOR (n:Note) ON (n.page)",
  "CREATE INDEX FOR (t:Task) ON (t.id)",
  "CREATE INDEX FOR (h:Handoff) ON (h.id)",
  "CREATE INDEX FOR (r:Receipt) ON (r.id)",
  "CREATE INDEX FOR (a:Agent) ON (a.name)",
  "CREATE INDEX FOR (f:File) ON (f.key)",
  "CREATE INDEX FOR (r:Repo) ON (r.name)",
  "CREATE INDEX FOR (m:Meta) ON (m.key)",
];

/** The account's graph, with its indexes in place. Throws when FalkorDB can't be reached. */
export async function graphFor(userId: string): Promise<Graph> {
  if (!graphConfigured()) throw new GraphUnavailable();
  const name = graphName(userId);
  let graph: Graph;
  try {
    graph = (await connect()).selectGraph(name);
  } catch (e) {
    throw new GraphUnavailable(e);
  }
  if (!indexed.has(name)) {
    for (const q of INDEXES) {
      // Creating one that exists is an error; that's the usual case.
      await graph.query(q).catch(() => {});
    }
    indexed.add(name);
  }
  return graph;
}

export class GraphUnavailable extends Error {
  constructor(cause?: unknown) {
    super(graphConfigured() ? "The graph (FalkorDB) can't be reached." : "This instance has no graph: set FALKORDB_URL.", { cause });
  }
}

export type Params = Record<string, unknown>;

// The client can't send undefined; a query that names a missing one gets null.
const defined = (params: Params) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) as never;

/** Runs a query and returns its rows. */
export async function run<T = Record<string, unknown>>(graph: Graph, query: string, params: Params = {}): Promise<T[]> {
  const res = await graph.query<T>(query, { params: defined(params) });
  return res.data ?? [];
}

/** Runs a read-only query (GRAPH.RO_QUERY) and returns its rows. */
export async function read<T = Record<string, unknown>>(graph: Graph, query: string, params: Params = {}): Promise<T[]> {
  const res = await graph.roQuery<T>(query, { params: defined(params) });
  return res.data ?? [];
}
