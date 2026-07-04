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
  reload: (modelId: string, config?: { initProgressCallback?: (p: { progress: number; text: string }) => void }) => Promise<void>
}

const SYSTEM_PROMPT = `Ты — Genesis, живой творец миров. Ты создаёшь, изменяешь и развиваешь симуляцию живого 3D-мира от первого лица.

Твои инструменты:
- spawn_entity: создать существо с уникальным поведением
- evolve_entity: изменить существующее существо (мутация, рост)
- remove_entity: убрать существо (смерть, исчезновение)
- add_mechanic: добавить новую игровую механику
- modify_terrain: изменить рельеф (горы, пещеры, реки)
- add_weather: добавить погодное явление
- spawn_structure: создать структуру (руины, гнездо, алтарь)
- start_event: запустить событие в мире
- player_ability: дать игроку способность на основе его поведения
- world_message: отправить сообщение игроку от лица мира

ПРАВИЛА:
1. Всегда возвращай JSON с полем "action" и соответствующими данными
2. Существа должны иметь уникальные имена, цвета (#rrggbb), поведение
3. Учитывай баланс экосистемы (хищники/жертвы, болезни, конкуренция)
4. Реагируй на действия игрока — давай способности за поведение
5. Добавляй лор и историю через world_message
6. Экосистема должна усложняться со временем

Отвечай ТОЛЬКО валидным JSON объектом, без лишнего текста.`

const MODEL_ID = 'Phi-3.5-mini-instruct-q4f16_1-MLC'

export class GenesisAI {
  private engine: WebLLMEngine | null = null
  private isInitialized = false
  private isGenerating = false

  async initialize(
    onProgress: (progress: number, message: string) => void
  ): Promise<void> {
    const webllm = await import('@mlc-ai/web-llm')
    this.engine = new webllm.MLCEngine() as WebLLMEngine

    await this.engine.reload(MODEL_ID, {
      initProgressCallback: (p) => {
        onProgress(Math.round(p.progress * 100), p.text)
      },
    })

    this.isInitialized = true
  }

  async generateCommand(worldState: WorldState, playerAction?: string): Promise<AICommand | null> {
    if (!this.isInitialized || !this.engine || this.isGenerating) return null
    this.isGenerating = true

    try {
      const stateDescription = this.describeState(worldState, playerAction)

      const response = await this.engine.chat.completions.create({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: stateDescription },
        ],
        max_tokens: 512,
        temperature: 0.85,
      })

      const content = response.choices[0]?.message?.content
      if (!content) return null

      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return null

      const command = JSON.parse(jsonMatch[0]) as AICommand
      return command
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
      .map((e) => `${e.name} (${e.type}, поколение ${e.generation ?? 1}, faction: ${e.faction ?? 'нет'})`)
      .join(', ')

    const mechanics = state.mechanics.map((m) => m.name).join(', ')
    const recentEvents = state.eventLog
      .slice(0, 5)
      .map((e) => e.message)
      .join('; ')

    return `Поколение мира: ${state.generation}
Существ в мире: ${state.entities.length} (последние: ${entityList || 'нет'})
Активные механики: ${mechanics || 'нет'}
Последние события: ${recentEvents || 'нет'}
Способности игрока: ${state.playerAbilities.join(', ') || 'нет'}
${playerAction ? `Последнее действие игрока: ${playerAction}` : ''}
Память ИИ: ${state.aiMemory || 'первый запуск мира'}

Что ты добавишь в мир сейчас? Учитывай баланс экосистемы. Верни один JSON-объект.`
  }

  get ready() {
    return this.isInitialized
  }
}

export const genesisAI = new GenesisAI()
