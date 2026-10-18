# YouTube upload

**Title** (under 100 characters):

> LockIn Manifest: agent handoffs that know when they went stale (FalkorDB · Graph Hacks)

**Visibility:** Public or Unlisted (the submission accepts either).

**Description:**

```
LockIn is a notebook your AI coding agents write to over MCP: they save what they learn, you witness it, and one agent hands its work to the next with a baton. LockIn Manifest puts that notebook in a FalkorDB graph, so every handoff knows what it rests on, keeps a receipt of exactly what the next agent was handed, and catches it when that goes stale.

Everything in the demo is a real run: two local agents (Qwen2.5-3B, Q4, on 4 CPU cores via llama.cpp) calling LockIn's MCP tools, each with its own token. Model thinking time is sped up; the tool calls and LockIn's replies are real. Narration: Chatterbox TTS.

Built for Graph Hacks (WeMakeDevs × FalkorDB), Tracks 02 (Agent Memory and Coordination) and 03 (Company Brain).

Code, graph model, Cypher queries and setup: https://github.com/Sky-walkerX/graph-hacks

0:00 LockIn Manifest
0:08 What LockIn is
0:20 A real run, with local agents
0:29 An agent records a decision; you witness it
0:37 It plans the work and leaves a baton
0:44 Pickup through the graph, with a receipt
0:53 The decision changes; the receipt goes stale
1:07 Stale work can't be called done
1:17 Finished work stays traceable
1:25 Who knows what (FalkorDB full-text + PageRank)
1:34 Tested against the original LockIn
1:46 Try it
```

**Tags:** FalkorDB, graph database, AI agents, MCP, Model Context Protocol, agent memory, Claude Code, coding agents, knowledge graph, WeMakeDevs, Graph Hacks, LockIn

**Thumbnail:** `docs/media/manifest-banner.png` works as is (1920×600 crops well at 1280×720 centre), or use a frame from step 05 (the refused "done").
