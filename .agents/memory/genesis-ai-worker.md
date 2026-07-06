---
name: GenesisAI Worker Architecture
description: How GenesisAI offloads Qwen2.5-3B inference to a Web Worker and the lifecycle rules that must be maintained.
---

## Rule
`@huggingface/transformers` pipeline (Qwen2.5-Coder-3B-Instruct) must run inside `genesis.worker.ts`, **never** on the main browser thread. WASM CPU inference takes 30–120 s and blocks Three.js + UI entirely if run on the main thread.

**Why:** The model runs on WASM when WebGPU is unavailable, fully saturating one CPU core synchronously. Three.js render loop, React re-renders, and browser input all stall during that time.

## Architecture
- `artifacts/genesis/src/ai/genesis.worker.ts` — the Web Worker. Handles `init` (loads pipeline) and `generate` (runs inference) messages. Posts back `progress`, `ready`, `init_error`, `generate_result`, `generate_error`.
- `artifacts/genesis/src/ai/GenesisAI.ts` — thin wrapper. Creates the worker via `new Worker(new URL('./genesis.worker.ts', import.meta.url), { type: 'module' })` (Vite module worker pattern).

## Lifecycle rules (enforce on every change)
1. **`_abortPending(reason)`** must be called before terminating/replacing the worker. It rejects the in-flight Promise and clears `isGenerating`, preventing permanent deadlock.
2. **`_onWorkerError`** is wired post-init via `w.onerror = this._onWorkerError`. It aborts pending generation and sets `isInitialized = false` so callers can reinitialize.
3. **`pending` struct** carries `{ id, resolve, reject, timeout }`. The `id` is checked in `_onWorkerMessage` to discard stale responses when a new worker is created mid-stream.
4. **Timeout** (5 min) guards against WASM devices hanging indefinitely.
5. **Init failure** terminates the worker immediately and nulls `this.worker`.

## Terrain note
Default segments reduced 400→256 (`createTerrain` in `TerrainSystem.ts`). 2.4× fewer vertices, terrain generation ~2× faster. Still visually adequate at play distances (20 units/segment, lowest terrain frequency is ~56 unit period → ~2.8 samples/period).
