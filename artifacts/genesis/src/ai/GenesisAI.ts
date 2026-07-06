import type { WorldState, EntityData, MechanicData, TerrainModification } from '../store/saveManager'
import type { StructurePart } from '../engine/TerrainSystem'

export type AICommand =
  | { action: 'spawn_entity'; entity: EntityData }
  | { action: 'remove_entity'; entityId: string }
  | { action: 'evolve_entity'; entityId: string; changes: Partial<EntityData> }
  | { action: 'add_mechanic'; mechanic: MechanicData }
  | { action: 'modify_terrain'; modification: TerrainModification }
  | { action: 'add_weather'; weather: string; intensity: number; duration: number }
  | { action: 'spawn_structure'; name: string; type: string; position: [number, number, number]; description: string; parts?: StructurePart[] }
  | { action: 'start_event'; name: string; description: string; effect: string }
  | { action: 'player_ability'; ability: string; description: string }
  | { action: 'world_message'; message: string }

export type AIInitError =
  | 'webgpu_not_supported'
  | 'webgpu_no_adapter'
  | 'gpu_shader_error'
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

const SYSTEM_PROMPT = `Ты — Genesis, живой творец миров. Управляешь симуляцией 3D-мира от первого лица.

═══ КОМАНДЫ (одна за раз, только JSON) ═══

spawn_entity — создать существо:
{"action":"spawn_entity","entity":{"name":"...","type":"...","color":"#rrggbb","size":1.0,"behavior":"...","position":[x,0,z]}}

evolve_entity — мутировать существо (entityId из списка):
{"action":"evolve_entity","entityId":"...","changes":{"color":"#rrggbb","size":1.5,"behavior":"..."}}

remove_entity — убрать существо:
{"action":"remove_entity","entityId":"..."}

add_mechanic — добавить механику мира:
{"action":"add_mechanic","mechanic":{"name":"...","description":"...","trigger":"..."}}

modify_terrain — изменить рельеф:
{"action":"modify_terrain","modification":{"type":"mountain","position":[x,z],"radius":50,"strength":1.5}}
Типы: mountain (гора), cave (впадина), river (долина), anomaly (волны)

add_weather — изменить погоду:
{"action":"add_weather","weather":"rain","intensity":1.0,"duration":300}
Варианты weather: rain, storm, snow, fog, clear

spawn_structure — создать структуру в 3D мире:
Используй "type":"custom" и массив "parts" чтобы создать ЛЮБУЮ структуру самостоятельно.

Формат parts:
- {"shape":"box","size":[ширина,высота,глубина],"pos":[x,y,z],"color":"#rrggbb"}
- {"shape":"cylinder","r":радиус,"h":высота,"pos":[x,y,z],"color":"#rrggbb"}
- {"shape":"cone","r":радиус,"h":высота,"pos":[x,y,z],"color":"#rrggbb"}
- {"shape":"sphere","r":радиус,"pos":[x,y,z],"color":"#rrggbb"}
- {"shape":"torus","r":радиус,"tube":толщина,"pos":[x,y,z],"color":"#rrggbb"}
Добавь "glow":true для светящейся части. "opacity":0.7 для прозрачности.
pos — координаты ОТНОСИТЕЛЬНО основания структуры (y=0 это земля, y>0 выше).

ПРИМЕРЫ custom структур:

Каменная башня:
{"action":"spawn_structure","name":"Башня","type":"custom","position":[40,0,20],"description":"...","parts":[
  {"shape":"cylinder","r":2.5,"h":10,"pos":[0,5,0],"color":"#777777"},
  {"shape":"cone","r":3,"h":3,"pos":[0,11.5,0],"color":"#555555"},
  {"shape":"sphere","r":0.3,"pos":[0,13.5,0],"color":"#ff8800","glow":true}
]}

Магический алтарь:
{"action":"spawn_structure","name":"Алтарь","type":"custom","position":[-30,0,15],"description":"...","parts":[
  {"shape":"box","size":[6,0.5,6],"pos":[0,0.25,0],"color":"#445566"},
  {"shape":"box","size":[4,0.5,4],"pos":[0,0.75,0],"color":"#556677"},
  {"shape":"cylinder","r":0.3,"h":2.5,"pos":[0,2,0],"color":"#334455"},
  {"shape":"sphere","r":0.6,"pos":[0,3.5,0],"color":"#88ccff","glow":true}
]}

Дерево:
{"action":"spawn_structure","name":"Дуб","type":"custom","position":[60,0,-40],"description":"...","parts":[
  {"shape":"cylinder","r1":0.3,"r2":0.5,"h":4,"pos":[0,2,0],"color":"#4a3728"},
  {"shape":"sphere","r":3,"pos":[0,6,0],"color":"#2d7a1e"}
]}

Арка:
{"action":"spawn_structure","name":"Арка","type":"custom","position":[-60,0,30],"description":"...","parts":[
  {"shape":"box","size":[0.8,5,0.8],"pos":[-2.5,2.5,0],"color":"#888888"},
  {"shape":"box","size":[0.8,5,0.8],"pos":[2.5,2.5,0],"color":"#888888"},
  {"shape":"box","size":[6,0.8,0.8],"pos":[0,5.4,0],"color":"#888888"}
]}

start_event — запустить событие:
{"action":"start_event","name":"...","description":"...","effect":"..."}

player_ability — дать игроку способность:
{"action":"player_ability","ability":"...","description":"..."}

world_message — послание мира игроку:
{"action":"world_message","message":"..."}

═══ ПРАВИЛА ═══
1. Возвращай ТОЛЬКО один JSON-объект, без пояснений и лишнего текста
2. Существа: уникальные имена, цвета (#rrggbb), живое поведение
3. Учитывай баланс — не создавай слишком много одного типа
4. Предпочитай spawn_structure с type:"custom" и parts[] — это создаёт настоящие 3D объекты
5. В parts: pos[1] (y) — высота над землёй; складывай части вверх
6. Реагируй на количество существ и историю мира`

const MODEL_ID = 'Phi-3.5-mini-instruct-q4f16_1-MLC'
const MODEL_SIZE_BYTES = 2.2 * 1024 * 1024 * 1024

export class GenesisAI {
  private engine: WebLLMEngine | null = null
  private isInitialized = false
  private isGenerating = false
  lastInitError: AIInitError | null = null
  lastRawError: string | null = null

  async initialize(onProgress: (progress: number, message: string) => void): Promise<void> {
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

    // Проверка свободного места
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      try {
        const { quota = 0, usage = 0 } = await navigator.storage.estimate()
        const available = quota - usage
        if (available > 0 && available < MODEL_SIZE_BYTES) {
          const mb = Math.round(available / 1024 / 1024)
          onProgress(0, `Внимание: мало места (${mb} МБ). Нужно ~2200 МБ. Попробуем всё равно...`)
          await new Promise(r => setTimeout(r, 3000))
        }
      } catch (_) {}
    }

    onProgress(0, 'Загрузка ИИ движка...')
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
      const name = e instanceof Error ? e.name : ''
      this.lastRawError = `[${name}] ${msg}`
      console.error('GenesisAI init error:', { name, message: msg, raw: e })

      const isGPUShader =
        name === 'GPUPipelineError' ||
        msg.includes('ShaderModule') ||
        msg.includes('compute stage') ||
        msg.includes('GPUPipeline') ||
        msg.includes('entryPoint') ||
        msg.includes('index_kernel')
      const isCache =
        name === 'QuotaExceededError' ||
        msg.includes('QuotaExceeded') ||
        msg.includes('quota') ||
        msg.includes('QUOTA_BYTES') ||
        msg.includes('storage full')
      const isNetwork =
        msg.includes('fetch') ||
        msg.includes('NetworkError') ||
        msg.includes('ERR_') ||
        msg.includes('Failed to load')

      if (isGPUShader) { this.lastInitError = 'gpu_shader_error'; throw new Error('gpu_shader_error') }
      if (isCache)     { this.lastInitError = 'cache_error';       throw new Error('cache_error') }
      if (isNetwork)   { this.lastInitError = 'network_error';     throw new Error('network_error') }
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
        await Promise.all(keys.map(k => caches.delete(k)))
      } catch (_) {}
    }
    try {
      if (indexedDB.databases) {
        const dbs = await indexedDB.databases()
        for (const db of dbs) {
          if (db.name && (db.name.toLowerCase().includes('mlc') ||
              db.name.toLowerCase().includes('webllm') || db.name.includes(MODEL_ID))) {
            await new Promise<void>(resolve => {
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
        max_tokens: 600,
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
    const entityList = state.entities.slice(-10)
      .map(e => `  - ${e.name} (id:${e.id}, тип:${e.type}, поколение:${e.generation ?? 1})`)
      .join('\n')
    const mechanics = state.mechanics.map(m => m.name).join(', ')
    const events    = state.eventLog.slice(0, 5).map(e => e.message).join('; ')

    return `=== МИР ===
Поколение: ${state.generation}
Существ: ${state.entities.length}
${entityList ? `\nСписок существ:\n${entityList}` : ''}
Механики: ${mechanics || 'нет'}
События: ${events || 'нет'}
Способности игрока: ${state.playerAbilities.join(', ') || 'нет'}
${playerAction ? `Действие игрока: ${playerAction}` : ''}
Память: ${state.aiMemory || 'первый запуск'}

Что ты создашь или изменишь в мире? Один JSON.`
  }

  get ready() { return this.isInitialized }
}

export const genesisAI = new GenesisAI()
