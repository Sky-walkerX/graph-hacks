import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetcher";
import { queryKeys } from "@/lib/query-keys";
import type { listHandoffs } from "@/lib/handoff/store";
import type { Attention } from "@/lib/notes/attention";
import type { Manifest } from "@/lib/graph/manifest";
import type { Outcome } from "@/lib/graph/context";
import type { Keystone, Known } from "@/lib/graph/brain";
import type { FoundDoc, StaleAnswer } from "@/lib/graph/ask";

type Json<T> = T extends Date ? string : T extends (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
export type HandoffRow = Json<Awaited<ReturnType<typeof listHandoffs>>[number]>;
export type AttentionRows = Json<Attention>;

// Agents leave batons and flags over MCP, out of the app's sight, so both
// lists refetch whenever the home page mounts.
export function useHandoffs() {
  return useQuery({
    queryKey: queryKeys.handoffs,
    queryFn: () => api.get<HandoffRow[]>("/api/handoffs"),
    refetchOnMount: "always",
  });
}

export function useAttention() {
  return useQuery({
    queryKey: queryKeys.attention,
    queryFn: () => api.get<AttentionRows>("/api/notes/attention"),
    refetchOnMount: "always",
  });
}

/** The user closes a baton nobody needs to pick up. */
export function useCloseHandoff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/handoffs/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: queryKeys.handoffs });
      const prev = qc.getQueryData<HandoffRow[]>(queryKeys.handoffs);
      qc.setQueryData<HandoffRow[]>(queryKeys.handoffs, (list) =>
        list?.map((h) => (h.id === id ? { ...h, status: "PICKED_UP", pickedUpBy: "web", pickedUpAt: new Date().toISOString() } : h)),
      );
      return { prev };
    },
    onError: (_e, _id, ctx) => qc.setQueryData(queryKeys.handoffs, ctx?.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.handoffs }),
  });
}

export type ManifestList = Json<{ available: boolean; manifests: Manifest[]; atRisk: Outcome[] }>;
export type ManifestRow = ManifestList["manifests"][number];
export type OutcomeRow = ManifestList["atRisk"][number];

// What each agent was handed when it picked up a baton, worked out in the
// graph, and what changed since. Refetched on mount, and every half minute
// while the page is open, since agents and witnessing move it on.
export function useManifests() {
  return useQuery({
    queryKey: queryKeys.manifests,
    queryFn: () => api.get<ManifestList>("/api/manifest"),
    refetchOnMount: "always",
    refetchInterval: 30_000,
  });
}

export type BrainResult = Json<{ available: boolean; keystones: Keystone[]; known: Known[]; docs: FoundDoc[]; reask: StaleAnswer[] }>;

// Who knows what (q: a topic or a file), or with no q the decisions the most
// work rests on. Read from the graph.
export function useBrain(q: string) {
  return useQuery({
    queryKey: queryKeys.brain(q),
    queryFn: () => api.get<BrainResult>(`/api/brain${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    refetchOnMount: "always",
  });
}

// An Ask conversation's answers that cite pages replaced or deleted since.
export function useStaleAnswers(chat: string | undefined) {
  return useQuery({
    queryKey: queryKeys.brain(`chat:${chat}`),
    queryFn: () => api.get<BrainResult>(`/api/brain?chat=${encodeURIComponent(chat!)}`),
    enabled: Boolean(chat),
    select: (d) => new Map(d.reask.map((a) => [a.id, a])),
  });
}
