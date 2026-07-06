/**
 * ModelStorage — export / import the cached Transformers.js model.
 *
 * Transformers.js stores model files in the browser's Cache API.
 * This module lets the user:
 *   - Export → pack all model files into a ZIP and download to disk.
 *   - Import → restore model files from a previously exported ZIP back
 *               into the Cache API so the next initAI() skips the download.
 *
 * ZIP uses store mode (level 0) because ONNX binaries are already compressed.
 * A manifest.json inside the ZIP records each file's original cache URL and
 * cache bucket name so restoration is byte-for-byte identical.
 *
 * Memory note: the model is ~1.5–2 GB.  Export/import each need ~2–4 GB
 * of free RAM.  Chrome typically handles this; close heavy tabs first if
 * you run into issues.
 */

import { Zip, ZipDeflate, unzip as fflateUnzip } from 'fflate'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StorageProgress {
  step: string
  current: number
  total: number
}

interface ManifestEntry {
  /** Filename inside the ZIP (no path, e.g. "model_q4.onnx") */
  zipName: string
  /** Full URL used as the Cache API key */
  cacheUrl: string
  /** Cache bucket name returned by caches.keys() */
  cacheName: string
  contentType: string
}

interface Manifest {
  version: 2
  modelId: string
  exportedAt: number
  files: ManifestEntry[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MODEL_PATTERN = /onnx-community\/Qwen2\.5-Coder/i
const MANIFEST_NAME = 'manifest.json'
const ZIP_NAME = 'genesis-model-backup.zip'

type CacheEntry = { request: Request; response: Response; cacheName: string }

async function findModelEntries(): Promise<CacheEntry[]> {
  if (!('caches' in window)) return []
  const result: CacheEntry[] = []
  for (const name of await caches.keys()) {
    const cache = await caches.open(name)
    for (const req of await cache.keys()) {
      if (MODEL_PATTERN.test(req.url)) {
        const res = await cache.match(req)
        if (res) result.push({ request: req, response: res, cacheName: name })
      }
    }
  }
  return result
}

/** Deduplicate zipNames so two files with the same basename don't collide. */
function makeZipName(url: string, index: number): string {
  const raw = url.split('/').pop()?.split('?')[0] ?? `file_${index}`
  return raw
}

// ─── Export ───────────────────────────────────────────────────────────────────

/**
 * Pack all cached model files into a ZIP and trigger a browser download.
 * @param onProgress  callback invoked after each file is packed
 */
export async function exportModel(
  onProgress: (p: StorageProgress) => void,
): Promise<void> {
  onProgress({ step: 'Поиск файлов модели в кеше…', current: 0, total: 1 })

  const entries = await findModelEntries()
  if (entries.length === 0) {
    throw new Error(
      'Файлы модели не найдены в кеше браузера.\n' +
      'Убедитесь, что модель была загружена хотя бы один раз.',
    )
  }

  // Build manifest
  const usedNames = new Set<string>()
  const manifest: Manifest = {
    version: 2,
    modelId: 'onnx-community/Qwen2.5-Coder-3B-Instruct',
    exportedAt: Date.now(),
    files: [],
  }

  for (let i = 0; i < entries.length; i++) {
    let zipName = makeZipName(entries[i].request.url, i)
    // Ensure unique names
    if (usedNames.has(zipName)) zipName = `file_${i}_${zipName}`
    usedNames.add(zipName)
    manifest.files.push({
      zipName,
      cacheUrl:    entries[i].request.url,
      cacheName:   entries[i].cacheName,
      contentType: entries[i].response.headers.get('content-type') ?? 'application/octet-stream',
    })
  }

  // Build ZIP
  const zipChunks: Uint8Array<ArrayBuffer>[] = []
  // fflate's Zip callback receives Uint8Array | FlateError; guard against error case
  const zip = new Zip((chunk) => {
    if (chunk instanceof Uint8Array) {
      // .slice() normalises the buffer type to ArrayBuffer (avoids SharedArrayBuffer ambiguity)
      zipChunks.push(chunk.slice())
    }
  })

  // Add manifest first
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2))
  const manifestEntry = new ZipDeflate(MANIFEST_NAME, { level: 0 })
  zip.add(manifestEntry)
  manifestEntry.push(manifestBytes, true)

  // Add model files one at a time (minimises peak memory)
  for (let i = 0; i < entries.length; i++) {
    const { request, response } = entries[i]
    const { zipName } = manifest.files[i]
    const label = zipName.length > 40 ? zipName.slice(-40) : zipName

    onProgress({ step: `Упаковка: ${label}`, current: i + 1, total: entries.length + 1 })

    const buf = await response.clone().arrayBuffer()
    const data = new Uint8Array(buf)

    const fileEntry = new ZipDeflate(zipName, { level: 0 })
    zip.add(fileEntry)

    // Push in 8 MB chunks so the GC can reclaim intermediate state
    const CHUNK = 8 * 1024 * 1024
    for (let off = 0; off < data.length; off += CHUNK) {
      const isLast = off + CHUNK >= data.length
      fileEntry.push(data.subarray(off, off + CHUNK), isLast)
    }

    // Allow previous source buffer to be GC'd before reading the next file
    ;(request as unknown as Record<string, unknown>)['_gc'] = null
  }

  zip.end()

  onProgress({ step: 'Подготовка файла для скачивания…', current: entries.length + 1, total: entries.length + 1 })

  const blob = new Blob(zipChunks as BlobPart[], { type: 'application/zip' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = ZIP_NAME
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url) }, 2000)
}

// ─── Import ───────────────────────────────────────────────────────────────────

/**
 * Restore model files from a previously exported ZIP back into the Cache API.
 * After this completes, calling genesisAI.initialize() will skip the download.
 * @param file        ZIP file selected by the user
 * @param onProgress  callback invoked after each file is restored
 */
export async function importModel(
  file: File,
  onProgress: (p: StorageProgress) => void,
): Promise<void> {
  onProgress({ step: 'Чтение архива…', current: 0, total: 1 })

  const zipBuffer = await file.arrayBuffer()
  const zipData   = new Uint8Array(zipBuffer)

  onProgress({ step: 'Распаковка…', current: 0, total: 1 })

  const extracted = await new Promise<Record<string, Uint8Array>>((res, rej) => {
    fflateUnzip(zipData, (err, data) => (err ? rej(err) : res(data)))
  })

  const manifestRaw = extracted[MANIFEST_NAME]
  if (!manifestRaw) {
    throw new Error(
      'Неверный формат архива — файл manifest.json не найден.\n' +
      'Используйте ZIP, созданный кнопкой «Сохранить модель».',
    )
  }

  const manifest = JSON.parse(new TextDecoder().decode(manifestRaw)) as Manifest

  // Restore each file to the exact Cache API bucket + URL it came from
  for (let i = 0; i < manifest.files.length; i++) {
    const entry   = manifest.files[i]
    const label   = entry.zipName.length > 40 ? entry.zipName.slice(-40) : entry.zipName
    onProgress({ step: `Восстановление: ${label}`, current: i + 1, total: manifest.files.length })

    const fileData = extracted[entry.zipName]
    if (!fileData) {
      console.warn('[ModelStorage] Файл не найден в архиве:', entry.zipName)
      continue
    }

    const cache = await caches.open(entry.cacheName)
    await cache.put(
      entry.cacheUrl,
      new Response(fileData.slice(), {
        status:  200,
        headers: {
          'Content-Type':   entry.contentType,
          'Content-Length': String(fileData.byteLength),
        },
      }),
    )
  }
}

// ─── Cache introspection ──────────────────────────────────────────────────────

/**
 * Returns the total byte size of all model files currently in cache,
 * or 0 if nothing is cached yet.
 */
export async function getModelCacheSize(): Promise<number> {
  const entries = await findModelEntries()
  let total = 0
  for (const { response } of entries) {
    const cl = response.headers.get('content-length')
    if (cl) total += Number(cl)
  }
  return total
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_048_576)        return `${(bytes / 1_024).toFixed(0)} КБ`
  if (bytes < 1_073_741_824)    return `${(bytes / 1_048_576).toFixed(1)} МБ`
  return `${(bytes / 1_073_741_824).toFixed(2)} ГБ`
}
