import { FalkorDB, type Graph } from "falkordb";

// The FalkorDB connection, and one graph per account. The graph holds what
// the notebook's tables can't answer by themselves: which pages replace which
// once witnessed, what a task or a note depends on, and exactly what each
// agent was given when it picked work up (lib/graph/receipts.ts).
//
// A graph's name comes from the signed-in account, never from what an agent
// sends, so one account's agents can't reach another's graph.

type Conn = { db: Promise<FalkorDB[]> };
const cache = globalThis as unknown as { falkorPool?: Conn };

// A connection runs one query at a time (the server answers a connection's
// commands in order), so with one, every agent waits behind every other.
// Queries go round a few connections instead; FalkorDB runs reads on them in
// parallel. A write's reply comes after it commits, so a read sent after it,
// on any connection, sees it.
const POOL = Math.max(1, Number(process.env.FALKORDB_POOL ?? 8));

/** Whether this instance has a graph at all (FALKORDB_URL is set). */
export const graphConfigured = () => Boolean(process.env.FALKORDB_URL);

function connect(): Promise<FalkorDB[]> {
  if (!cache.falkorPool) {
    const db = Promise.all(Array.from({ length: POOL }, () => FalkorDB.connect({ url: process.env.FALKORDB_URL })));
    // A failed connect is dropped, so the next call tries again.
    db.catch(() => (cache.falkorPool = undefined));
    cache.falkorPool = { db };
  }
  return cache.falkorPool.db;
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
  "CREATE INDEX FOR (a:Answer) ON (a.id)",
  "CREATE INDEX FOR (a:Answer) ON (a.chat)",
  "CREATE INDEX FOR (d:Doc) ON (d.id)",
  "CREATE INDEX FOR (x:Attempt) ON (x.id)",
  // who_knows searches what notes say (lib/graph/brain.ts).
  "CALL db.idx.fulltext.createNodeIndex('Note', 'title', 'summary')",
  "CALL db.idx.fulltext.createNodeIndex('Doc', 'title', 'summary')",
];

/** The account's graph, with its indexes in place. Throws when FalkorDB can't be reached. */
export async function graphFor(userId: string): Promise<Graph> {
  if (!graphConfigured()) throw new GraphUnavailable();
  const name = graphName(userId);
  let graph: Graph;
  try {
    graph = pooled((await connect()).map((db) => db.selectGraph(name)));
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

/** One graph across the pool: each query takes the next connection. */
function pooled(graphs: Graph[]): Graph {
  let next = 0;
  const one = () => graphs[next++ % graphs.length];
  const graph: Pick<Graph, "query" | "roQuery" | "delete"> = {
    query: (q, o) => one().query(q, o),
    roQuery: (q, o) => one().roQuery(q, o),
    delete: () => graphs[0].delete(),
  };
  return graph as Graph;
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
