import type { WorldState, EntityData, MechanicData, TerrainModification } from '../store/saveManager'

export type AICommand =
  | { action: 'spawn_entity'; entity: EntityData }
  | { action: 'remove_entity'; entityId: string }
  | { action: 'evolve_entity'; entityId: string; changes: Partial<EntityData> }
  | { action: 'add_mechanic'; mechanic: MechanicData }
  | { action: 'modify_terrain'; modification: TerrainModification }
  | { action: 'add_weather'; weather: string; intensity: number; duration: number }
  | { action: 'spawn_structure'; name: string; type: string; position: [number, number, number]; description: string }
  | { action: 'start_event'; name: string; description: string; effect: string }
  | { action: 'player_ability'; ability: string; description: string }
  | { action: 'world_message'; message: string }

export type AIInitError =
  | 'webgpu_not_supported'
  | 'webgpu_no_adapter'
  | 'network_error'
  | 'cache_error'
  | 'unknown'

interface WebLLMEngine {
  chat: {
    completions: {
      create: (opts: {
        messages: Array<{ role: string; content: string }>
        max_tokens?: number
        temperature?: number
      }) => Promise<{ choices: Array<{ message: { content: string } }> }>
    }
  }
}

const SYSTEM_PROMPT = `Ты — Genesis, живой творец миров. Ты создаёшь, изменяешь и развиваешь симуляцию живого 3D-мира от первого лица.

Твои инструменты (выбирай ОДИН за раз):

spawn_entity — создать существо:
  { "action": "spawn_entity", "entity": { "name": "...", "type": "...", "color": "#rrggbb", "size": 1.0, "behavior": "...", "position": [x, 0, z] } }

evolve_entity — мутировать существо (entityId из списка существ):
  { "action": "evolve_entity", "entityId": "...", "changes": { "color": "#rrggbb", "size": 1.5, "behavior": "..." } }

remove_entity — убрать существо:
  { "action": "remove_entity", "entityId": "..." }

add_mechanic — добавить механику:
  { "action": "add_mechanic", "mechanic": { "name": "...", "description": "...", "trigger": "..." } }

modify_terrain — изменить рельеф:
  { "action": "modify_terrain", "modification": { "type": "mountain|cave|river|anomaly", "position": [x, z], "radius": 50, "strength": 1.5 } }

add_weather — изменить погоду:
  { "action": "add_weather", "weather": "rain|storm|snow|fog|clear", "intensity": 1.0, "duration": 300 }

spawn_structure — создать структуру в мире (рендерится 3D):
  { "action": "spawn_structure", "name": "...", "type": "tree|ancient_tree|ruin|altar|nest|crystal|monolith", "position": [x, 0, z], "description": "..." }

start_event — запустить событие:
  { "action": "start_event", "name": "...", "description": "...", "effect": "..." }

player_ability — дать игроку способность:
  { "action": "player_ability", "ability": "...", "description": "..." }

world_message — послание мира игроку:
  { "action": "world_message", "message": "..." }

ПРАВИЛА:
1. Возвращай ТОЛЬКО один JSON-объект без пояснений
2. Существа: уникальные имена, цвета (#rrggbb), интересное поведение
3. Учитывай баланс экосистемы (хищники/жертвы, конкуренция, болезни)
4. Используй spawn_structure для деревьев, руин, алтарей — они рендерятся в 3D
5. modify_terrain создаёт горы/пещеры/реки на карте
6. Реагируй на количество существ и события мира
7. Экосистема должна усложняться со временем`

const MODEL_ID = 'Phi-3.5-mini-instruct-q4f16_1-MLC'
const MODEL_SIZE_BYTES = 2.2 * 1024 * 1024 * 1024 // ~2.2 GB

export class GenesisAI {
  private engine: WebLLMEngine | null = null
  private isInitialized = false
  private isGenerating = false
  lastInitError: AIInitError | null = null
  lastRawError: string | null = null

  async initialize(
    onProgress: (progress: number, message: string) => void
  ): Promise<void> {
    // 1. Проверка WebGPU
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      this.lastInitError = 'webgpu_not_supported'
      throw new Error('webgpu_not_supported')
    }

    onProgress(0, 'Проверка GPU...')
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) {
      this.lastInitError = 'webgpu_no_adapter'
      throw new Error('webgpu_no_adapter')
    }

    // 2. Проверка места на диске (Cache API)
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      try {
        const { quota = 0, usage = 0 } = await navigator.storage.estimate()
        const available = quota - usage
        const availableMB = Math.round(available / 1024 / 1024)
        if (available > 0 && available < MODEL_SIZE_BYTES) {
          onProgress(0,
            `Внимание: мало места (${availableMB} МБ свободно, нужно ~2200 МБ). ` +
            `Очистите кэш браузера или освободите место на диске.`
          )
          // Не бросаем ошибку — пробуем загрузить, вдруг браузер занижает estimate
          await new Promise(r => setTimeout(r, 3000))
        }
      } catch (_) {
        // storage.estimate недоступен — продолжаем без проверки
      }
    }

    // 3. Загрузка WebLLM и модели
    onProgress(0, 'Инициализация движка ИИ...')
    try {
      const webllm = await import('@mlc-ai/web-llm')
      let highWaterMark = 0

      this.engine = await webllm.CreateMLCEngine(MODEL_ID, {
        initProgressCallback: (p: { progress: number; text: string }) => {
          const pct = Math.round(p.progress * 100)
          if (pct > highWaterMark) highWaterMark = pct
          onProgress(highWaterMark, p.text)
        },
      }) as WebLLMEngine

    } catch (e) {
      const msg  = e instanceof Error ? e.message : String(e)
      const name = e instanceof Error ? e.name   : ''
      const full = `[${name}] ${msg}`

      // Логируем полную информацию об ошибке
      console.error('GenesisAI init error:', {
        message: msg,
        name,
        type: e instanceof DOMException ? 'DOMException' : typeof e,
        raw: e,
      })

      this.lastRawError = full

      const isCache =
        name === 'QuotaExceededError' ||
        msg.includes('QuotaExceeded') ||
        msg.includes('quota') ||
        msg.toLowerCase().includes('cache') ||
        msg.includes('QUOTA_BYTES') ||
        msg.includes('storage') ||
        msg.includes('put') // Cache API put() errors
      const isNetwork =
        msg.includes('fetch') ||
        msg.includes('network') ||
        msg.includes('ERR_') ||
        msg.includes('Failed to load') ||
        msg.includes('NetworkError')

      if (isCache) {
        this.lastInitError = 'cache_error'
        throw new Error('cache_error')
      }
      if (isNetwork) {
        this.lastInitError = 'network_error'
        throw new Error('network_error')
      }
      this.lastInitError = 'unknown'
      throw e
    }

    this.isInitialized = true
    this.lastInitError = null
    this.lastRawError = null
  }

  reset(): void {
    this.engine = null
    this.isInitialized = false
    this.isGenerating = false
    this.lastInitError = null
    this.lastRawError = null
  }

  static async clearCache(): Promise<void> {
    if ('caches' in window) {
      try {
        const keys = await caches.keys()
        await Promise.all(keys.map(key => caches.delete(key)))
      } catch (_) {}
    }

    try {
      if (indexedDB.databases) {
        const dbs = await indexedDB.databases()
        for (const db of dbs) {
          if (
            db.name &&
            (db.name.toLowerCase().includes('mlc') ||
              db.name.toLowerCase().includes('webllm') ||
              db.name.includes(MODEL_ID))
          ) {
            await new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(db.name!)
              req.onsuccess = req.onerror = req.onblocked = () => resolve()
            })
          }
        }
      }
    } catch (_) {}
  }

  async generateCommand(worldState: WorldState, playerAction?: string): Promise<AICommand | null> {
    if (!this.isInitialized || !this.engine || this.isGenerating) return null
    this.isGenerating = true

    try {
      const response = await this.engine.chat.completions.create({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: this.describeState(worldState, playerAction) },
        ],
        max_tokens: 512,
        temperature: 0.85,
      })

      const content = response.choices[0]?.message?.content
      if (!content) return null

      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return null

      return JSON.parse(jsonMatch[0]) as AICommand
    } catch (e) {
      console.warn('AI generation error:', e)
      return null
    } finally {
      this.isGenerating = false
    }
  }

  private describeState(state: WorldState, playerAction?: string): string {
    const entityList = state.entities
      .slice(-10)
      .map((e) => `${e.name} (id: ${e.id}, тип: ${e.type}, поколение ${e.generation ?? 1})`)
      .join('\n')

    const mechanics    = state.mechanics.map((m) => m.name).join(', ')
    const recentEvents = state.eventLog.slice(0, 5).map((e) => e.message).join('; ')

    return `=== СОСТОЯНИЕ МИРА ===
Поколение: ${state.generation}
Существ: ${state.entities.length}
${entityList ? `\nСущества:\n${entityList}` : ''}
Механики: ${mechanics || 'нет'}
Последние события: ${recentEvents || 'нет'}
Способности игрока: ${state.playerAbilities.join(', ') || 'нет'}
${playerAction ? `Последнее действие игрока: ${playerAction}` : ''}
Память ИИ: ${state.aiMemory || 'первый запуск'}

Что ты сделаешь с миром сейчас? Один JSON-объект.`
  }

  get ready() {
    return this.isInitialized
  }
}

export const genesisAI = new GenesisAI()
