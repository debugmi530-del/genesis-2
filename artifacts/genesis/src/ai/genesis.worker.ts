/**
 * GenesisAI Web Worker
 *
 * Runs the Transformers.js pipeline in a separate thread so that model
 * loading and LLM inference never block the Three.js render loop or any
 * other UI work on the main thread.
 */
import { pipeline } from '@huggingface/transformers'

const MODEL_ID = 'onnx-community/Qwen2.5-Coder-3B-Instruct'

// ─── Message types ────────────────────────────────────────────────────────────

export type WorkerInMessage =
  | { type: 'init'; device: 'webgpu' | 'wasm'; dtype: string }
  | { type: 'generate'; id: number; messages: WMsg[]; maxTokens: number; temperature: number }

export type WorkerOutMessage =
  | { type: 'progress'; progress: number; message: string }
  | { type: 'ready';    backend: 'webgpu' | 'wasm' }
  | { type: 'init_error'; error: string }
  | { type: 'generate_result'; id: number; content: string }
  | { type: 'generate_error';  id: number; error: string }

type WMsg = { role: string; content: string }

// ─── State ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipe: any = null

function post(msg: WorkerOutMessage) {
  self.postMessage(msg)
}

function formatBytes(b: number): string {
  if (b < 1_048_576) return `${(b / 1024).toFixed(0)}КБ`
  if (b < 1_073_741_824) return `${(b / 1_048_576).toFixed(0)}МБ`
  return `${(b / 1_073_741_824).toFixed(1)}ГБ`
}

// ─── Message handler ──────────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data

  // ── Initialize pipeline ──────────────────────────────────────────────────
  if (msg.type === 'init') {
    try {
      let highWaterMark = 0
      const fileBytes = new Map<string, { loaded: number; total: number }>()
      const label = msg.device === 'webgpu' ? 'GPU' : 'CPU'

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pipe = await (pipeline as any)('text-generation', MODEL_ID, {
        device: msg.device,
        dtype:  msg.dtype,
        progress_callback: (info: {
          status: string
          progress?: number
          file?: string
          loaded?: number
          total?: number
        }) => {
          if (info.status === 'progress' && typeof info.progress === 'number') {
            const pct = Math.round(info.progress)
            if (pct > highWaterMark) highWaterMark = pct
            const file = info.file?.split('/').pop() ?? ''
            if (info.file && info.loaded !== undefined && info.total !== undefined) {
              fileBytes.set(info.file, { loaded: info.loaded, total: info.total })
            }
            let totalLoaded = 0, totalSize = 0
            for (const { loaded, total } of fileBytes.values()) {
              totalLoaded += loaded; totalSize += total
            }
            const size = totalSize > 0 ? ` (${formatBytes(totalLoaded)}/${formatBytes(totalSize)})` : ''
            post({ type: 'progress', progress: highWaterMark, message: `[${label}] ${file} — ${pct}%${size}` })
          } else if (info.status === 'ready') {
            post({ type: 'progress', progress: 100, message: `[${label}] Модель готова` })
          }
        },
      })

      post({ type: 'ready', backend: msg.device })
    } catch (err) {
      post({ type: 'init_error', error: String(err) })
    }
    return
  }

  // ── Generate command ──────────────────────────────────────────────────────
  if (msg.type === 'generate') {
    if (!pipe) {
      post({ type: 'generate_error', id: msg.id, error: 'Pipeline not initialized' })
      return
    }
    try {
      const output = await pipe(msg.messages, {
        max_new_tokens: msg.maxTokens,
        temperature:    msg.temperature,
        do_sample:      true,
      })
      const generated = output[0]?.generated_text
      let content: string
      if (Array.isArray(generated)) {
        content = (generated as WMsg[]).at(-1)?.content ?? ''
      } else {
        content = String(generated ?? '')
      }
      post({ type: 'generate_result', id: msg.id, content })
    } catch (err) {
      post({ type: 'generate_error', id: msg.id, error: String(err) })
    }
  }
}
