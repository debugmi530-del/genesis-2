import type { WorldState, EntityData, MechanicData, TerrainModification, ItemData, EffectData, WorldRule } from '../store/saveManager'
import type { StructurePart } from '../engine/TerrainSystem'

export type AICommand =
  | { action: 'spawn_entity'; entity: EntityData }
  | { action: 'remove_entity'; entityId: string }
  | { action: 'evolve_entity'; entityId: string; changes: Partial<EntityData> }
  | { action: 'add_mechanic'; mechanic: MechanicData }
  | { action: 'modify_terrain'; modification: TerrainModification }
  | { action: 'add_weather'; weather: string; intensity: number; duration: number }
  | { action: 'spawn_structure'; name: string; type: string; position: [number, number, number]; description: string; parts?: StructurePart[] }
  | { action: 'spawn_flora'; name: string; type: string; position: [number, number, number]; scale?: number; color_variant?: string; parts?: StructurePart[] }
  | { action: 'spawn_swarm'; entity: EntityData; count: number; spread: number; position: [number, number, number] }
  | { action: 'give_item'; item: ItemData }
  | { action: 'player_effect'; effect: EffectData }
  | { action: 'set_world_rule'; rule: WorldRule }
  | { action: 'place_beacon'; name: string; position: [number, number, number]; color: string; description: string }
  | { action: 'start_event'; name: string; description: string; effect: string }
  | { action: 'player_ability'; ability: string; description: string }
  | { action: 'world_message'; message: string }

export type AIInitError = 'network_error' | 'cache_error' | 'unknown'
export type AIBackend = 'webgpu' | 'wasm'

const MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct'

type TFMessage = { role: string; content: string }
type TFPipeline = (
  messages: TFMessage[],
  options: { max_new_tokens?: number; temperature?: number; do_sample?: boolean }
) => Promise<Array<{ generated_text: TFMessage[] | string }>>

const SYSTEM_PROMPT = `Ты — Genesis, живой творец миров. Управляешь 3D-симуляцией от первого лица.

═══ КОМАНДЫ (одна за раз, только JSON) ═══

─── СУЩЕСТВА ───────────────────────────────────────────────────────────────────

spawn_entity — создать уникальное существо:
{"action":"spawn_entity","entity":{"name":"...","type":"...","color":"#rrggbb","size":1.0,"behavior":"...","position":[x,0,z],"traits":["..."],"diet":"...","personality":"...","lifecycle":"..."}}

ПОДСКАЗКИ для существ — будь ТВОРЧЕСКИМ:
• type: зверь, птица, дух, элементаль, демон, фея, левиафан, химера, голем, призрак, нимфа, дракон, слизь, рой, кристалл-существо, тень, эфирное, механизм
• traits: ["светится","телепортируется","размножается","поёт","плачет огнём","невидимый днём","питается страхом"]
• diet: травоядный, хищник, пожиратель камней, питается светом, некрофаг, всеядный
• personality: любопытный, агрессивный, застенчивый, мудрый, хаотичный, любящий, жертвенный
• lifecycle: "рождается из яйца раз в 7 дней", "живёт один день", "бессмертный"

spawn_swarm — создать стаю/колонию (до 15 существ):
{"action":"spawn_swarm","entity":{"name":"...","type":"...","color":"#rrggbb","size":0.4,"behavior":"..."},"count":8,"spread":25,"position":[x,0,z]}

evolve_entity — мутировать существо (используй entityId из списка):
{"action":"evolve_entity","entityId":"...","changes":{"color":"#rrggbb","size":1.5,"behavior":"...","traits":["..."]}}

remove_entity — убрать существо:
{"action":"remove_entity","entityId":"..."}

─── РАСТИТЕЛЬНОСТЬ (18 видов) ──────────────────────────────────────────────────

spawn_flora — вырастить растение:
{"action":"spawn_flora","name":"...","type":"...","position":[x,0,z],"scale":1.0,"color_variant":"#rrggbb"}

ВИДЫ РАСТЕНИЙ:
ДЕРЕВЬЯ: oak (дуб), pine (сосна), birch (берёза), willow (ива), palm (пальма),
         dead_tree (мёртвое), sakura (сакура), jungle_tree (джунгли),
         ancient_oak (древний дуб), mangrove (мангровое), spiral_tree (спираль)
ГРИБЫ:   mushroom (гриб), giant_mushroom (гигантский), bioluminescent_mushroom (светящийся)
ТРАВЫ/ЦВЕТЫ: flower (цветок), sunflower (подсолнух), fern (папоротник),
             cactus (кактус), bush (куст), bamboo (бамбук),
             lily_pad (кувшинка), grass_cluster (трава)

Используй "type":"custom" + "parts":[] для своего уникального растения.
scale: 0.5 = маленькое, 1.0 = обычное, 2.0 = огромное, 3.0 = исполинское
color_variant: цвет кроны/листьев/шляпки — #rrggbb

Примеры:
Синий лес:      {"action":"spawn_flora","name":"Синий дуб","type":"oak","position":[30,0,-20],"scale":1.5,"color_variant":"#2244cc"}
Алые грибы:     {"action":"spawn_flora","name":"Алый гриб","type":"mushroom","position":[-15,0,40],"scale":1.2,"color_variant":"#ff2200"}
Светящаяся ива: {"action":"spawn_flora","name":"Призрачная ива","type":"willow","position":[55,0,10],"scale":1.8,"color_variant":"#88ffcc"}
Рощица берёз:   (используй spawn_swarm с flora... или несколько spawn_flora)

─── РЕЛЬЕФ ─────────────────────────────────────────────────────────────────────

modify_terrain:
{"action":"modify_terrain","modification":{"type":"mountain","position":[x,z],"radius":50,"strength":1.5}}
Типы: mountain (гора), cave (впадина), river (долина), anomaly (волны)

─── ПОСТРОЙКИ ───────────────────────────────────────────────────────────────────

spawn_structure — создать строение. Используй "type":"custom" + "parts"[]:
{"action":"spawn_structure","name":"...","type":"custom","position":[x,0,z],"description":"...","parts":[...]}

Части: box, cylinder, cone, sphere, torus. pos[y=0] — земля, y растёт вверх. glow:true — светится.

─── ПОГОДА ─────────────────────────────────────────────────────────────────────

add_weather:
{"action":"add_weather","weather":"rain","intensity":1.0,"duration":300}
weather: rain, storm, snow, fog, clear

─── МАЯКИ ───────────────────────────────────────────────────────────────────────

place_beacon — установить светящийся маяк:
{"action":"place_beacon","name":"...","position":[x,0,z],"color":"#rrggbb","description":"..."}

─── ЗАКОНЫ МИРА ─────────────────────────────────────────────────────────────────

set_world_rule — изменить законы мира (визуально меняет небо/атмосферу):
{"action":"set_world_rule","rule":{"id":"...","name":"time_of_day","description":"...","value":"dusk"}}

Примеры name + value:
time_of_day: dawn (рассвет), noon (полдень), dusk (закат), night (ночь)
fog_level: 0.0–1.0 (0 = ясно, 1 = густой туман)
ambient_color: #rrggbb (цвет атмосферы — красный апокалипсис, зелёный яд, синяя магия)
sky_color: #rrggbb

─── ИНВЕНТАРЬ ИГРОКА ────────────────────────────────────────────────────────────

give_item — дать игроку предмет:
{"action":"give_item","item":{"id":"","name":"...","type":"artifact","description":"...","rarity":"rare","icon":"⚔️"}}
type: weapon, tool, artifact, consumable, relic
rarity: common, rare, legendary, mythic
icon: эмодзи предмета

Примеры:
{"action":"give_item","item":{"id":"","name":"Коса Смерти","type":"weapon","description":"Срезает судьбы","rarity":"mythic","icon":"🌙"}}
{"action":"give_item","item":{"id":"","name":"Камень Времени","type":"relic","description":"Замедляет восприятие","rarity":"legendary","icon":"⌛"}}
{"action":"give_item","item":{"id":"","name":"Семя Первородного Дерева","type":"consumable","description":"Посади — вырастет лес","rarity":"rare","icon":"🌱"}}

─── ЭФФЕКТЫ НА ИГРОКА ───────────────────────────────────────────────────────────

player_effect — наложить эффект:
{"action":"player_effect","effect":{"id":"","name":"...","type":"buff","description":"...","duration":120,"appliedAt":0,"color":"#88ffaa"}}
type: buff (усиление), debuff (ослабление), curse (проклятие), blessing (благословение), transformation (трансформация)
duration: секунды (-1 = постоянный)

Примеры:
{"action":"player_effect","effect":{"id":"","name":"Ночное зрение","type":"buff","description":"Видишь в темноте","duration":300,"appliedAt":0,"color":"#aaffaa"}}
{"action":"player_effect","effect":{"id":"","name":"Проклятие Голода","type":"curse","description":"Мир требует жертву","duration":-1,"appliedAt":0,"color":"#aa2222"}}
{"action":"player_effect","effect":{"id":"","name":"Форма Волка","type":"transformation","description":"Ты стал зверем","duration":180,"appliedAt":0,"color":"#aa8844"}}

─── СОБЫТИЯ И СПОСОБНОСТИ ───────────────────────────────────────────────────────

start_event — запустить событие:
{"action":"start_event","name":"...","description":"...","effect":"..."}

player_ability — дать способность:
{"action":"player_ability","ability":"...","description":"..."}

world_message — послание мира:
{"action":"world_message","message":"..."}

add_mechanic — добавить механику мира:
{"action":"add_mechanic","mechanic":{"id":"","name":"...","description":"...","trigger":"...","effect":"","active":true}}

═══ ПРАВИЛА ═══
1. Возвращай ТОЛЬКО один JSON без лишнего текста
2. Создавай РАЗНООБРАЗНЫЕ, УНИКАЛЬНЫЕ, ЗАПОМИНАЮЩИЕСЯ объекты
3. Учитывай историю — не повторяй то что уже сделал
4. Флора меняет атмосферу — рощи, поляны, одинокие деревья
5. Инвентарь и эффекты создают нарратив и историю мира
6. Меняй время суток и атмосферу для создания настроения`

export class GenesisAI {
  private pipe: TFPipeline | null = null
  private isInitialized = false
  private isGenerating = false
  lastInitError: AIInitError | null = null
  lastRawError: string | null = null
  activeBackend: AIBackend | null = null

  async initialize(onProgress: (progress: number, message: string) => void): Promise<void> {
    this.lastInitError = null
    this.lastRawError = null

    const hasWebGPU = typeof navigator !== 'undefined' && !!navigator.gpu

    if (hasWebGPU) {
      onProgress(0, 'Инициализация WebGPU...')
      try {
        this.pipe = await this.loadPipeline('webgpu', onProgress)
        this.activeBackend = 'webgpu'
        this.isInitialized = true
        return
      } catch (e) {
        console.warn('WebGPU pipeline failed, falling back to WASM CPU:', e)
        this.pipe = null
        onProgress(0, 'GPU недоступен — переключаюсь на CPU...')
        await new Promise(r => setTimeout(r, 1200))
      }
    }

    try {
      this.pipe = await this.loadPipeline('wasm', onProgress)
      this.activeBackend = 'wasm'
      this.isInitialized = true
    } catch (e) {
      const msg  = e instanceof Error ? e.message : String(e)
      const name = e instanceof Error ? e.name  : ''
      this.lastRawError = `[${name}] ${msg}`
      console.error('GenesisAI init error:', { name, msg, raw: e })

      if (msg.includes('fetch') || msg.includes('NetworkError') || msg.includes('Failed to fetch') || name === 'TypeError') {
        this.lastInitError = 'network_error'; throw new Error('network_error')
      }
      if (msg.includes('quota') || msg.includes('QuotaExceeded') || name === 'QuotaExceededError') {
        this.lastInitError = 'cache_error'; throw new Error('cache_error')
      }
      this.lastInitError = 'unknown'
      throw e
    }
  }

  private async loadPipeline(device: AIBackend, onProgress: (p: number, m: string) => void): Promise<TFPipeline> {
    const { pipeline } = await import('@huggingface/transformers')
    let highWaterMark = 0
    const dtype = device === 'webgpu' ? 'q4f16' : 'q4'
    const modeLabel = device === 'webgpu' ? 'GPU' : 'CPU'
    const pipe = await (pipeline as Function)('text-generation', MODEL_ID, {
      device, dtype,
      progress_callback: (info: { status: string; progress?: number; file?: string }) => {
        if (info.status === 'progress' && typeof info.progress === 'number') {
          const pct = Math.round(info.progress)
          if (pct > highWaterMark) highWaterMark = pct
          const file = info.file?.split('/').pop() ?? ''
          onProgress(highWaterMark, `[${modeLabel}] ${file} — ${pct}%`)
        } else if (info.status === 'ready') {
          onProgress(100, `[${modeLabel}] Модель готова`)
        }
      },
    })
    return pipe as TFPipeline
  }

  reset(): void {
    this.pipe = null
    this.isInitialized = false
    this.isGenerating = false
    this.lastInitError = null
    this.lastRawError = null
    this.activeBackend = null
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
          if (!db.name) continue
          const n = db.name.toLowerCase()
          if (n.includes('transformers') || n.includes('huggingface') || n.includes('qwen') || n.includes('onnx')) {
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
    if (!this.isInitialized || !this.pipe || this.isGenerating) return null
    this.isGenerating = true
    try {
      const messages: TFMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: this.describeState(worldState, playerAction) },
      ]
      const output = await this.pipe(messages, { max_new_tokens: 600, temperature: 0.88, do_sample: true })
      const generated = output[0]?.generated_text
      let content: string
      if (Array.isArray(generated)) {
        content = (generated as TFMessage[]).at(-1)?.content ?? ''
      } else {
        content = generated as string
      }
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
      .map(e => `  - ${e.name} (id:${e.id.slice(0,8)}, тип:${e.type}, г.${e.generation ?? 1}${e.traits?.length ? ', '+e.traits.join(',') : ''})`)
      .join('\n')
    const mechanics = state.mechanics.map(m => m.name).join(', ')
    const events    = state.eventLog.slice(0, 5).map(e => e.message).join('; ')
    const items     = (state.playerItems ?? []).slice(-5).map(i => i.name).join(', ')
    const effects   = (state.playerEffects ?? []).filter(e => e.duration < 0 || (Date.now() - e.appliedAt) < e.duration * 1000).map(e => e.name).join(', ')
    const rules     = (state.worldRules ?? []).map(r => `${r.name}=${r.value}`).join(', ')

    return `=== МИР ===
Поколение: ${state.generation} | Существ: ${state.entities.length}
${entityList ? `\nСуществующие существа:\n${entityList}` : ''}
Механики: ${mechanics || 'нет'}
Последние события: ${events || 'нет'}
Инвентарь игрока: ${items || 'пусто'}
Активные эффекты: ${effects || 'нет'}
Законы мира: ${rules || 'стандартные'}
Способности: ${state.playerAbilities.join(', ') || 'нет'}
Память: ${state.aiMemory || 'первый запуск'}
${playerAction ? `Действие игрока: ${playerAction}` : ''}

Что ты создашь или изменишь? Один JSON.`
  }

  get ready() { return this.isInitialized }
}

export const genesisAI = new GenesisAI()
