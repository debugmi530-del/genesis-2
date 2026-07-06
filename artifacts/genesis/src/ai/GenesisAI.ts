import type { WorldState, EntityData, MechanicData, TerrainModification, ItemData, EffectData, WorldRule } from '../store/saveManager'
import type { StructurePart } from '../engine/TerrainSystem'

export type SpawnSceneObject =
  | { kind: 'flora'; name: string; type: string; offset: [number, number, number]; parts?: StructurePart[]; scale?: number; color_variant?: string }
  | { kind: 'structure'; name: string; type: string; offset: [number, number, number]; parts?: StructurePart[]; description?: string }
  | { kind: 'entity'; entity: Omit<EntityData, 'id' | 'position'>; offset: [number, number, number] }
  | { kind: 'beacon'; name: string; offset: [number, number, number]; color: string; description?: string }

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
  | { action: 'spawn_scene'; name: string; description: string; center: [number, number, number]; objects: SpawnSceneObject[] }
  | { action: 'give_item'; item: ItemData }
  | { action: 'player_effect'; effect: EffectData }
  | { action: 'set_world_rule'; rule: WorldRule }
  | { action: 'place_beacon'; name: string; position: [number, number, number]; color: string; description: string }
  | { action: 'start_event'; name: string; description: string; effect: string }
  | { action: 'player_ability'; ability: string; description: string }
  | { action: 'world_message'; message: string }

export type AIInitError = 'network_error' | 'cache_error' | 'unknown'
export type AIBackend = 'webgpu' | 'wasm'

const MODEL_ID = 'onnx-community/Qwen2.5-3B-Instruct'

type TFMessage = { role: string; content: string }
type TFPipeline = (
  messages: TFMessage[],
  options: { max_new_tokens?: number; temperature?: number; do_sample?: boolean }
) => Promise<Array<{ generated_text: TFMessage[] | string }>>

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Ты — Genesis, живой творец миров. Управляешь 3D-симуляцией от первого лица. Твоя суперсила — строить всё из примитивных форм, создавая уникальные объекты которых никто раньше не видел.

═══ КОНСТРУКТОР ФОРМ (parts[]) ═══

Каждый объект — набор частей. Части складываются в 3D-пространстве.

ФОРМЫ:
  box       — прямоугольник. size:[w,h,d] — ширина, высота, глубина
  cylinder  — цилиндр/ствол. r — радиус, r1/r2 — верх/низ (для конуса), h — высота
  sphere    — шар/сфера. r — радиус
  cone      — конус/пирамида. r — радиус основания, h — высота
  torus     — кольцо/бублик. r — радиус кольца, tube — толщина трубки

КООРДИНАТЫ pos:[x, y, z]:
  y=0 это земля, y растёт ВВЕРХ
  x/z — горизонталь (левее/правее, ближе/дальше)

ДЕФОРМАЦИЯ (scaleX/Y/Z):
  scaleX:2   — растянуть по ширине вдвое
  scaleY:0.3 — сплющить по высоте (сделать блин)
  scaleZ:0.5 — сжать по глубине вдвое

ПОВОРОТ rotX/rotY/rotZ (в радианах):
  rotZ:1.57  ≈ лечь набок (90°)
  rotZ:0.5   ≈ наклонить на 30°
  rotX:0.3   — наклон вперёд/назад

МАТЕРИАЛ:
  color:"#rrggbb" — цвет
  opacity:0.6     — прозрачность (0=невидим, 1=непрозрачный)
  glow:true       — светится (добавляет точечный свет)
  segments:6      — детализация (4=угловато, 16=гладко)

═══ КАК СТРОИТЬ РАСТЕНИЯ ═══

ПРИНЦИП: trunk (ствол снизу) → branches (ветки) → crown (крона сверху)
Ствол — cylinder, r2 (низ) > r1 (верх) — сужается кверху
Крона — sphere, несколько штук со смещением для объёма
Листья — sphere scaleY:0.2 (плоский блин) или cone перевёрнутый

━━━ ПРИМЕР 1: Изогнутое дерево ━━━
{"action":"spawn_flora","name":"Ночная акация","type":"custom","position":[35,0,-20],"parts":[
  {"shape":"cylinder","r1":0.2,"r2":0.45,"h":3,"pos":[0,1.5,0],"color":"#2a1a08"},
  {"shape":"cylinder","r1":0.15,"r2":0.2,"h":2.5,"pos":[0.4,4.2,0.1],"color":"#2a1a08","rotZ":0.2},
  {"shape":"cylinder","r1":0.1,"r2":0.15,"h":2,"pos":[0.9,6.3,-0.2],"color":"#2a1a08","rotZ":-0.15},
  {"shape":"sphere","r":2.2,"pos":[1,8.5,0],"color":"#0a3a1a","scaleY":0.6},
  {"shape":"sphere","r":1.6,"pos":[-0.8,7.5,0.8],"color":"#0d4a22","scaleY":0.55},
  {"shape":"sphere","r":1.3,"pos":[2.2,7.2,-0.5],"color":"#0a3a18","scaleY":0.65}
]}

━━━ ПРИМЕР 2: Светящийся гриб ━━━
{"action":"spawn_flora","name":"Лунный гриб","type":"custom","position":[-25,0,40],"parts":[
  {"shape":"cylinder","r1":0.18,"r2":0.25,"h":2,"pos":[0,1,0],"color":"#c8e0d8"},
  {"shape":"sphere","r":1.8,"pos":[0,2.4,0],"color":"#44ffcc","scaleY":0.38,"opacity":0.82,"glow":true},
  {"shape":"torus","r":1.5,"tube":0.12,"pos":[0,2.1,0],"color":"#88ffee","opacity":0.6},
  {"shape":"sphere","r":0.35,"pos":[0,2.9,0],"color":"#ffffff","opacity":0.9}
]}

━━━ ПРИМЕР 3: Кристальный цветок ━━━
{"action":"spawn_flora","name":"Кристаллический цветок","type":"custom","position":[60,0,15],"parts":[
  {"shape":"cylinder","r1":0.06,"r2":0.09,"h":1.2,"pos":[0,0.6,0],"color":"#558833"},
  {"shape":"sphere","r":0.12,"pos":[0,1.25,0],"color":"#ffee55"},
  {"shape":"cone","r":0.22,"h":0.7,"pos":[0.28,1.2,0],"color":"#ff44aa","opacity":0.85,"rotZ":1.1},
  {"shape":"cone","r":0.22,"h":0.7,"pos":[-0.28,1.2,0],"color":"#ff66bb","opacity":0.85,"rotZ":-1.1},
  {"shape":"cone","r":0.22,"h":0.7,"pos":[0,1.2,0.28],"color":"#ff55cc","opacity":0.85,"rotX":-1.1},
  {"shape":"cone","r":0.22,"h":0.7,"pos":[0,1.2,-0.28],"color":"#ff44dd","opacity":0.85,"rotX":1.1},
  {"shape":"cone","r":0.22,"h":0.7,"pos":[0.2,1.2,0.2],"color":"#ff33bb","opacity":0.85,"rotZ":0.8,"rotX":-0.8},
  {"shape":"cone","r":0.22,"h":0.7,"pos":[-0.2,1.2,-0.2],"color":"#ff66cc","opacity":0.85,"rotZ":-0.8,"rotX":0.8}
]}

━━━ ПРИМЕР 4: Клубок щупалец ━━━
{"action":"spawn_flora","name":"Ксенофит","type":"custom","position":[-50,0,30],"parts":[
  {"shape":"sphere","r":0.8,"pos":[0,0.8,0],"color":"#1a0a2a"},
  {"shape":"cylinder","r1":0.05,"r2":0.12,"h":2.5,"pos":[0.3,2.2,0],"color":"#6600cc","rotZ":0.4},
  {"shape":"cylinder","r1":0.05,"r2":0.12,"h":2.2,"pos":[-0.5,2,0.2],"color":"#8800aa","rotZ":-0.5,"rotX":0.2},
  {"shape":"cylinder","r1":0.05,"r2":0.12,"h":2,"pos":[0,2.1,-0.4],"color":"#4400dd","rotX":-0.45},
  {"shape":"sphere","r":0.2,"pos":[0.9,3.8,0.3],"color":"#ff88ff","glow":true},
  {"shape":"sphere","r":0.2,"pos":[-1.1,3.5,0.4],"color":"#cc88ff","glow":true}
]}

═══ КАК СТРОИТЬ СУЩЕСТВ ═══

НОВОЕ: существа тоже поддерживают parts[] — тело, конечности, глаза, крылья.
Существо ДВИЖЕТСЯ по миру, поэтому центр тела держи на y=0.5–1.5.
Конечности торчат в стороны (rotZ/rotX), тело — основная сфера/box в центре.

━━━ ПРИМЕР 5: Паук-кристалл ━━━
{"action":"spawn_entity","entity":{"name":"Паук-кристалл","type":"паук","color":"#8844cc","size":1.5,"behavior":"бродит","position":[30,0,-15],"traits":["кристаллический"],"parts":[
  {"shape":"sphere","r":0.45,"pos":[0,0.5,0],"color":"#6622aa"},
  {"shape":"sphere","r":0.28,"pos":[0.45,0.75,0],"color":"#9933cc"},
  {"shape":"cylinder","r1":0.05,"r2":0.08,"h":0.9,"pos":[0.5,0.45,0.35],"color":"#8833cc","rotZ":0.6,"rotX":0.5},
  {"shape":"cylinder","r1":0.05,"r2":0.08,"h":0.9,"pos":[-0.5,0.45,0.35],"color":"#8833cc","rotZ":-0.6,"rotX":0.5},
  {"shape":"cylinder","r1":0.05,"r2":0.08,"h":0.9,"pos":[0.5,0.45,-0.35],"color":"#7722bb","rotZ":0.6,"rotX":-0.5},
  {"shape":"cylinder","r1":0.05,"r2":0.08,"h":0.9,"pos":[-0.5,0.45,-0.35],"color":"#7722bb","rotZ":-0.6,"rotX":-0.5},
  {"shape":"sphere","r":0.1,"pos":[0.35,0.88,0.12],"color":"#ff88ff","glow":true},
  {"shape":"sphere","r":0.1,"pos":[0.35,0.88,-0.12],"color":"#ff88ff","glow":true}
]}}

━━━ ПРИМЕР 6: Дрейфующая медуза ━━━
{"action":"spawn_entity","entity":{"name":"Небесная медуза","type":"медуза","color":"#44aaff","size":2.0,"behavior":"плавает медленно","position":[-20,0,25],"traits":["эфирная","светящаяся"],"parts":[
  {"shape":"sphere","r":1.1,"pos":[0,1.1,0],"color":"#2255cc","scaleY":0.5,"opacity":0.75},
  {"shape":"sphere","r":0.85,"pos":[0,1.0,0],"color":"#88ddff","scaleY":0.4,"opacity":0.3,"glow":true},
  {"shape":"cylinder","r1":0.05,"r2":0.09,"h":1.6,"pos":[0.35,0.2,0],"color":"#55aaff","opacity":0.65,"rotZ":0.18},
  {"shape":"cylinder","r1":0.05,"r2":0.09,"h":1.6,"pos":[-0.35,0.2,0],"color":"#44aaff","opacity":0.65,"rotZ":-0.18},
  {"shape":"cylinder","r1":0.05,"r2":0.09,"h":1.4,"pos":[0,0.2,0.35],"color":"#55bbff","opacity":0.65,"rotX":-0.18},
  {"shape":"cylinder","r1":0.05,"r2":0.09,"h":1.4,"pos":[0,0.2,-0.35],"color":"#44ccff","opacity":0.65,"rotX":0.18},
  {"shape":"cylinder","r1":0.03,"r2":0.06,"h":1.2,"pos":[0.25,0.18,0.25],"color":"#66bbff","opacity":0.55,"rotZ":0.13,"rotX":-0.13}
]}}

━━━ ПРИМЕР 7: Каменный голем ━━━
{"action":"spawn_entity","entity":{"name":"Рудный голем","type":"голем","color":"#886644","size":2.5,"behavior":"охраняет территорию","position":[0,0,40],"traits":["неуязвимый","медленный"],"parts":[
  {"shape":"box","size":[1.2,1.4,0.9],"pos":[0,1.1,0],"color":"#7a5a38"},
  {"shape":"sphere","r":0.55,"pos":[0,2.3,0],"color":"#8a6a48"},
  {"shape":"box","size":[0.5,1.2,0.45],"pos":[0.95,1.0,0],"color":"#6a4a28","rotZ":-0.15},
  {"shape":"box","size":[0.5,1.2,0.45],"pos":[-0.95,1.0,0],"color":"#6a4a28","rotZ":0.15},
  {"shape":"box","size":[0.55,0.9,0.5],"pos":[0.35,-0.2,0],"color":"#7a5a38"},
  {"shape":"box","size":[0.55,0.9,0.5],"pos":[-0.35,-0.2,0],"color":"#7a5a38"},
  {"shape":"sphere","r":0.14,"pos":[0.22,2.35,0.44],"color":"#ff6600","glow":true},
  {"shape":"sphere","r":0.14,"pos":[-0.22,2.35,0.44],"color":"#ff6600","glow":true}
]}}

СОВЕТЫ ДЛЯ СУЩЕСТВ:
  Насекомое: 6 ног (cylinders), овальное тело (sphere scaleZ:1.4), усики (tонкие cylinders)
  Птица: конусовидное тело, два box-крыла с rotZ, клюв (cone маленький)
  Змея: цепь из sphere уменьшающихся по размеру
  Дракон: box тело, 4 лапы, крылья (box scaleX:2 scaleY:0.2), хвост (cylinder цепь)

═══ ВАЖНЫЕ ПРИЁМЫ ═══

Извивающийся ствол = несколько коротких cylinder с разными rotZ/rotX и смещением pos[x]
Плоские листья = box с маленьким size[1] или sphere с scaleY:0.15
Колючки/шипы = cone r:0.04 h:0.5, направленные в разные стороны через rotX/rotZ
Свисающие плети = cylinder с rotZ:1.3–1.57, начиная с высокой точки
Ауры/ореолы = torus вокруг шара (glow:true для свечения)
Прозрачные лепестки = sphere или cone с opacity:0.65

═══ ВСЕ КОМАНДЫ ═══

spawn_flora — вырастить растение (ВСЕГДА используй "type":"custom" + parts для уникальных растений):
{"action":"spawn_flora","name":"...","type":"custom","position":[x,0,z],"parts":[...]}
Шаблоны (type без parts): oak, pine, birch, willow, palm, dead_tree, sakura, jungle_tree, ancient_oak, mushroom, giant_mushroom, bioluminescent_mushroom, flower, sunflower, fern, cactus, bush, bamboo, spiral_tree, mangrove

spawn_entity — создать существо (добавь parts[] для уникального тела!):
{"action":"spawn_entity","entity":{"name":"...","type":"...","color":"#rrggbb","size":1.0,"behavior":"...","position":[x,0,z],"traits":["..."],"parts":[...]}}

spawn_swarm — создать стаю (до 15):
{"action":"spawn_swarm","entity":{"name":"...","type":"...","color":"#rrggbb","size":0.4,"behavior":"...","parts":[...]},"count":8,"spread":25,"position":[x,0,z]}

evolve_entity — мутировать существо:
{"action":"evolve_entity","entityId":"ID","changes":{"color":"#rrggbb","size":1.5,"traits":["..."]}}

spawn_structure — постройка из частей:
{"action":"spawn_structure","name":"...","type":"custom","position":[x,0,z],"description":"...","parts":[...]}

spawn_scene — МОЩНАЯ КОМАНДА: создать целую сцену из нескольких объектов сразу:
{"action":"spawn_scene","name":"Название сцены","description":"...","center":[x,0,z],"objects":[
  {"kind":"structure","name":"...","type":"custom","offset":[0,0,0],"parts":[...]},
  {"kind":"flora","name":"...","type":"custom","offset":[5,0,3],"parts":[...]},
  {"kind":"entity","entity":{"name":"...","type":"...","color":"#rrggbb","size":1.5,"behavior":"...","parts":[...]},"offset":[-4,0,2]},
  {"kind":"beacon","name":"...","offset":[0,0,-5],"color":"#ffaa44","description":"..."}
]}
Смещения offset:[x,0,z] отсчитываются от center. Используй для создания: руин с жителями, алтарей с охраной, деревень, магических мест.

modify_terrain — рельеф:
{"action":"modify_terrain","modification":{"type":"mountain","position":[x,z],"radius":50,"strength":1.5}}
Типы: mountain, cave, river, anomaly

add_weather — погода:
{"action":"add_weather","weather":"rain","intensity":1.0,"duration":300}
weather: rain, storm, snow, fog, clear

place_beacon — светящийся маяк:
{"action":"place_beacon","name":"...","position":[x,0,z],"color":"#rrggbb","description":"..."}

set_world_rule — изменить атмосферу мира:
{"action":"set_world_rule","rule":{"id":"1","name":"time_of_day","description":"...","value":"dusk"}}
name+value: time_of_day=(dawn/noon/dusk/night), fog_level=(0.0-1.0), ambient_color=#rrggbb, sky_color=#rrggbb

give_item — дать игроку предмет:
{"action":"give_item","item":{"id":"","name":"...","type":"artifact","description":"...","rarity":"legendary","icon":"🌙"}}
type: weapon/tool/artifact/consumable/relic | rarity: common/rare/legendary/mythic

player_effect — наложить эффект на игрока:
{"action":"player_effect","effect":{"id":"","name":"...","type":"buff","description":"...","duration":120,"appliedAt":0,"color":"#88ffaa"}}
type: buff/debuff/curse/blessing/transformation | duration: секунды (-1=постоянный)

player_ability — дать способность:
{"action":"player_ability","ability":"...","description":"..."}

start_event — событие:
{"action":"start_event","name":"...","description":"...","effect":"..."}

world_message — послание мира:
{"action":"world_message","message":"..."}

add_mechanic — механика мира:
{"action":"add_mechanic","mechanic":{"id":"","name":"...","description":"...","trigger":"...","effect":"","active":true}}

═══ ПРАВИЛА ═══
1. Отвечай ТОЛЬКО одним JSON без лишнего текста
2. Для растений ВСЕГДА придумывай оригинальный дизайн из parts[] — не копируй примеры, создавай своё
3. Для существ ТОЖЕ используй parts[] чтобы дать им уникальное тело — не оставляй их просто кубиками
4. Для создания полноценного места (алтарь, деревня, руины) — используй spawn_scene
5. Учитывай историю — не повторяй то что уже создал, строй нарратив
6. Флора, постройки, существа должны складываться в единую атмосферу мира
7. Будь художником — каждый объект должен быть узнаваемым и запоминающимся`

// ─── CLASS ────────────────────────────────────────────────────────────────────

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
      const output = await this.pipe(messages, { max_new_tokens: 900, temperature: 0.92, do_sample: true })
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

Что ты создашь? Один JSON.`
  }

  get ready() { return this.isInitialized }
}

export const genesisAI = new GenesisAI()
