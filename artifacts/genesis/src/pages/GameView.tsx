import { useEffect, useRef, useState, useCallback } from 'react'
import { GameEngine } from '../engine/GameEngine'
import { genesisAI } from '../ai/GenesisAI'
import { useGameStore } from '../store/gameStore'
import { saveManager } from '../store/saveManager'
import type { EntityData, MechanicData, ItemData, EffectData, WorldRule } from '../store/saveManager'

interface Props {
  onExit: () => void
}

const AI_INTERVAL_MS = 45_000

export default function GameView({ onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<GameEngine | null>(null)
  const aiIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const saveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const aiThinkingRef = useRef(false)
  const runAITickRef = useRef<() => void>(() => {})

  const [paused, setPaused] = useState(false)
  const [showLog, setShowLog] = useState(true)
  const [showInventory, setShowInventory] = useState(false)
  const [aiThinking, setAiThinking] = useState(false)
  const [lastAiAction, setLastAiAction] = useState<string>('')

  const {
    currentWorld, addEvent, addEntity, removeEntity,
    updateEntity, addMechanic, addTerrainMod, addPlayerAbility,
    addItem, addEffect, setWorldRule,
    updateAiMemory, incrementGeneration, updatePlayTime, aiReady,
  } = useGameStore()

  const runAITick = useCallback(async () => {
    if (!currentWorld || !aiReady || aiThinkingRef.current) return
    aiThinkingRef.current = true
    setAiThinking(true)

    try {
      const command = await genesisAI.generateCommand(currentWorld.worldState)
      if (!command) return

      switch (command.action) {

        case 'spawn_entity': {
          const entity: EntityData = {
            ...command.entity,
            id: command.entity.id || crypto.randomUUID(),
            position: command.entity.position || [(Math.random()-0.5)*80, 0, (Math.random()-0.5)*80],
            generation: (command.entity.generation ?? 0) + 1,
          }
          addEntity(entity)
          engineRef.current?.spawnEntity(entity)
          addEvent({ message: `ИИ создал: ${entity.name} — ${entity.behavior}`, type: 'ai_create' })
          setLastAiAction(`Создал: ${entity.name}`)
          incrementGeneration()
          break
        }

        case 'spawn_swarm': {
          const { entity: base, count = 5, spread = 20, position } = command
          const pos: [number, number, number] = Array.isArray(position) && position.length >= 3
            ? position : [(Math.random()-0.5)*80, 0, (Math.random()-0.5)*80]
          const n = Math.min(Math.max(1, count), 15)
          for (let i = 0; i < n; i++) {
            const angle = (i/n)*Math.PI*2
            const dist = (Math.random()*0.8+0.2)*spread
            const entity: EntityData = {
              ...base,
              id: crypto.randomUUID(),
              position: [pos[0]+Math.cos(angle)*dist, 0, pos[2]+Math.sin(angle)*dist],
              generation: (base.generation ?? 0) + 1,
            }
            addEntity(entity)
            engineRef.current?.spawnEntity(entity)
          }
          addEvent({ message: `ИИ создал стаю: ${n}× ${base.name}`, type: 'ai_create' })
          setLastAiAction(`Стая: ${n}× ${base.name}`)
          incrementGeneration()
          break
        }

        case 'remove_entity': {
          removeEntity(command.entityId)
          engineRef.current?.removeEntity(command.entityId)
          addEvent({ message: `ИИ убрал существо`, type: 'ai_update' })
          setLastAiAction('Убрал существо')
          break
        }

        case 'evolve_entity': {
          updateEntity(command.entityId, command.changes)
          engineRef.current?.updateEntity(command.entityId, command.changes)
          addEvent({ message: `ИИ эволюционировал существо`, type: 'ai_update' })
          setLastAiAction('Мутация существа')
          break
        }

        case 'add_mechanic': {
          const mechanic: MechanicData = {
            ...command.mechanic,
            id: command.mechanic.id || crypto.randomUUID(),
            active: true,
          }
          addMechanic(mechanic)
          addEvent({ message: `ИИ добавил механику: ${mechanic.name}`, type: 'ai_create' })
          setLastAiAction(`Механика: ${mechanic.name}`)
          break
        }

        case 'modify_terrain': {
          const mod = command.modification
          if (mod?.type && mod.position && mod.radius && mod.strength) {
            engineRef.current?.applyTerrainMod(mod)
            addTerrainMod(mod)
            const names: Record<string, string> = { mountain: 'гора', cave: 'пещера', river: 'река', anomaly: 'аномалия' }
            addEvent({ message: `ИИ изменил рельеф: ${names[mod.type] ?? mod.type}`, type: 'world' })
            setLastAiAction(`Рельеф: ${names[mod.type] ?? mod.type}`)
          }
          break
        }

        case 'add_weather': {
          const { weather, intensity } = command
          if (weather) {
            engineRef.current?.setWeather(weather, intensity ?? 1)
            addEvent({ message: `Погода: ${weather} (${intensity ?? 1})`, type: 'world' })
            setLastAiAction(`Погода: ${weather}`)
          }
          break
        }

        case 'spawn_structure': {
          const { name, type, position, parts } = command
          if (name && type) {
            const pos: [number, number, number] = Array.isArray(position) && position.length >= 3
              ? position : [(Math.random()-0.5)*100, 0, (Math.random()-0.5)*100]
            engineRef.current?.spawnStructure(name, type, pos, parts)
            addEvent({ message: `ИИ построил: ${name} (${parts?.length ?? 0} частей)`, type: 'ai_create' })
            setLastAiAction(`Постройка: ${name}`)
          }
          break
        }

        case 'spawn_flora': {
          const { name, type, position, parts, scale, color_variant } = command
          if (name && type) {
            const pos: [number, number, number] = Array.isArray(position) && position.length >= 3
              ? position : [(Math.random()-0.5)*120, 0, (Math.random()-0.5)*120]
            engineRef.current?.spawnFlora(name, type, pos, parts, scale ?? 1.0, color_variant)
            addEvent({ message: `ИИ вырастил: ${name} (${type})`, type: 'ai_create' })
            setLastAiAction(`Флора: ${name}`)
          }
          break
        }

        case 'give_item': {
          const item: ItemData = {
            ...command.item,
            id: crypto.randomUUID(),
          }
          addItem(item)
          const rarityLabel: Record<string, string> = { mythic: 'мифический', legendary: 'легендарный', rare: 'редкий', common: 'обычный' }
          addEvent({ message: `${item.icon ?? '📦'} Получен: ${item.name} [${rarityLabel[item.rarity] ?? item.rarity}]`, type: 'ai_create' })
          setLastAiAction(`Предмет: ${item.name}`)
          break
        }

        case 'player_effect': {
          const effect: EffectData = {
            ...command.effect,
            id: crypto.randomUUID(),
            appliedAt: Date.now(),
          }
          addEffect(effect)
          addEvent({ message: `✨ Эффект: ${effect.name} — ${effect.description}`, type: 'ai_create' })
          setLastAiAction(`Эффект: ${effect.name}`)
          break
        }

        case 'set_world_rule': {
          const { rule } = command
          if (rule?.name) {
            const r: WorldRule = { ...rule, id: rule.id || crypto.randomUUID() }
            setWorldRule(r)
            engineRef.current?.setWorldRule(rule.name, rule.value)
            addEvent({ message: `🌍 Закон мира: ${rule.name} → ${rule.value}`, type: 'world' })
            setLastAiAction(`Закон: ${rule.name}`)
          }
          break
        }

        case 'place_beacon': {
          const { name, position, color, description } = command
          if (name) {
            const pos: [number, number, number] = Array.isArray(position) && position.length >= 3
              ? position : [(Math.random()-0.5)*100, 0, (Math.random()-0.5)*100]
            engineRef.current?.placeBeacon(name, pos, color ?? '#88aaff')
            addEvent({ message: `💫 Маяк: ${name} — ${description || ''}`, type: 'world' })
            setLastAiAction(`Маяк: ${name}`)
          }
          break
        }

        case 'spawn_scene': {
          const { name: sceneName, description: sceneDesc, center, objects } = command
          if (!Array.isArray(objects) || objects.length === 0) break
          const cx = center?.[0] ?? (Math.random() - 0.5) * 100
          const cz = center?.[2] ?? (Math.random() - 0.5) * 100
          let spawned = 0
          for (const obj of objects) {
            const px = cx + (obj.offset?.[0] ?? 0)
            const pz = cz + (obj.offset?.[2] ?? 0)
            const pos: [number, number, number] = [px, 0, pz]
            if (obj.kind === 'flora') {
              engineRef.current?.spawnFlora(obj.name, obj.type ?? 'custom', pos, obj.parts as never, obj.scale ?? 1.0, obj.color_variant)
              spawned++
            } else if (obj.kind === 'structure') {
              engineRef.current?.spawnStructure(obj.name, obj.type ?? 'custom', pos, obj.parts as never)
              spawned++
            } else if (obj.kind === 'entity') {
              const entity: EntityData = {
                ...obj.entity,
                id: crypto.randomUUID(),
                position: pos,
                generation: 1,
                health: obj.entity.health ?? 100,
                color: obj.entity.color ?? '#888888',
                size: obj.entity.size ?? 1,
              }
              addEntity(entity)
              engineRef.current?.spawnEntity(entity)
              spawned++
            } else if (obj.kind === 'beacon') {
              engineRef.current?.placeBeacon(obj.name, pos, obj.color ?? '#88aaff')
              spawned++
            }
          }
          addEvent({ message: `🌐 Сцена: ${sceneName} — ${sceneDesc || ''} (${spawned} объектов)`, type: 'ai_create' })
          setLastAiAction(`Сцена: ${sceneName}`)
          incrementGeneration()
          break
        }

        case 'start_event': {
          addEvent({ message: `⚡ Событие: ${command.name} — ${command.description}`, type: 'world' })
          setLastAiAction(`Событие: ${command.name}`)
          break
        }

        case 'player_ability': {
          addPlayerAbility(command.ability)
          addEvent({ message: `⭐ Способность: ${command.ability} — ${command.description}`, type: 'ai_create' })
          setLastAiAction(`Способность: ${command.ability}`)
          break
        }

        case 'world_message': {
          addEvent({ message: `💬 ${command.message}`, type: 'world' })
          setLastAiAction('Послание мира')
          break
        }
      }

      updateAiMemory(`Поколение ${currentWorld.worldState.generation}: ${command.action}`)
    } catch (e) {
      console.warn('AI tick error', e)
    } finally {
      aiThinkingRef.current = false
      setAiThinking(false)
    }
  }, [currentWorld, aiReady, addEntity, addEvent, addMechanic, addTerrainMod, addPlayerAbility, addItem, addEffect, setWorldRule, incrementGeneration, removeEntity, updateAiMemory, updateEntity])

  useEffect(() => { runAITickRef.current = runAITick }, [runAITick])

  useEffect(() => {
    if (!canvasRef.current || !currentWorld) return
    const engine = new GameEngine(canvasRef.current, currentWorld, () => setPaused(true))
    engineRef.current = engine
    engine.start()
    aiIntervalRef.current = setInterval(() => runAITickRef.current(), AI_INTERVAL_MS)
    saveIntervalRef.current = setInterval(async () => {
      const latestWorld = useGameStore.getState().currentWorld
      if (latestWorld) {
        updatePlayTime(30)
        await saveManager.saveWorld({ ...latestWorld, lastPlayedAt: Date.now() }).catch(() => {})
      }
    }, 30_000)
    if (aiReady) setTimeout(() => runAITickRef.current(), 3000)
    return () => {
      engine.dispose()
      if (aiIntervalRef.current) clearInterval(aiIntervalRef.current)
      if (saveIntervalRef.current) clearInterval(saveIntervalRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (aiReady && engineRef.current) setTimeout(() => runAITickRef.current(), 2000)
  }, [aiReady]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (aiIntervalRef.current) clearInterval(aiIntervalRef.current)
    if (!paused) aiIntervalRef.current = setInterval(() => runAITickRef.current(), AI_INTERVAL_MS)
  }, [paused])

  const recentEvents = currentWorld?.worldState.eventLog.slice(0, 8) ?? []
  const items = currentWorld?.worldState.playerItems ?? []
  const activeEffects = (currentWorld?.worldState.playerEffects ?? []).filter(
    e => e.duration < 0 || (Date.now() - e.appliedAt) < e.duration * 1000
  )

  return (
    <div className="relative w-full h-full bg-black select-none">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        onClick={() => { if (!paused) engineRef.current?.requestPointerLock() }}
      />

      {/* Прицел */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
        <div className="w-4 h-4 flex items-center justify-center">
          <div className="w-[2px] h-3 bg-white opacity-70 absolute" />
          <div className="w-3 h-[2px] bg-white opacity-70 absolute" />
        </div>
      </div>

      {/* Инвентарь / эффекты (левый нижний угол) */}
      <div className="absolute bottom-4 left-4 flex flex-col gap-2 pointer-events-auto">
        {/* Активные эффекты */}
        {activeEffects.length > 0 && (
          <div className="flex flex-col gap-1">
            {activeEffects.slice(-4).map((eff) => (
              <div
                key={eff.id}
                className="text-xs px-2 py-0.5 rounded-full backdrop-blur-sm border"
                style={{
                  color: eff.color ?? '#88ffcc',
                  borderColor: (eff.color ?? '#88ffcc') + '44',
                  backgroundColor: (eff.color ?? '#88ffcc') + '18',
                }}
              >
                ✨ {eff.name}{eff.duration > 0 ? ` (${Math.max(0, Math.round((eff.duration - (Date.now()-eff.appliedAt)/1000)))}с)` : ' ∞'}
              </div>
            ))}
          </div>
        )}

        {/* Последние предметы */}
        {items.length > 0 && (
          <div className="flex gap-1.5 items-center flex-wrap max-w-[300px]">
            {items.slice(-6).map((item) => {
              const rarityColor: Record<string, string> = { mythic: '#cc44ff', legendary: '#ffaa00', rare: '#4488ff', common: '#888888' }
              return (
                <div
                  key={item.id}
                  title={`${item.name}: ${item.description}`}
                  className="text-sm bg-black/60 border rounded px-1.5 py-0.5 backdrop-blur-sm cursor-default"
                  style={{ borderColor: rarityColor[item.rarity] + '66' }}
                >
                  {item.icon ?? '📦'}
                </div>
              )
            })}
            {items.length > 6 && (
              <div className="text-xs text-white/40">+{items.length - 6}</div>
            )}
            <button
              onClick={() => setShowInventory(v => !v)}
              className="text-xs text-white/30 hover:text-white/60 ml-1"
            >
              {showInventory ? '▲' : '▼'}
            </button>
          </div>
        )}

        {/* Развёрнутый инвентарь */}
        {showInventory && items.length > 0 && (
          <div className="bg-black/80 border border-zinc-800 rounded-lg p-3 w-72 max-h-52 overflow-y-auto backdrop-blur-sm">
            <div className="text-xs text-zinc-500 mb-2 tracking-widest uppercase">Инвентарь</div>
            <div className="flex flex-col gap-1.5">
              {items.map(item => {
                const rarityColor: Record<string, string> = { mythic: '#cc44ff', legendary: '#ffaa00', rare: '#4488ff', common: '#888888' }
                return (
                  <div key={item.id} className="flex items-start gap-2">
                    <span className="text-base">{item.icon ?? '📦'}</span>
                    <div>
                      <div className="text-xs font-medium" style={{ color: rarityColor[item.rarity] ?? '#ffffff' }}>
                        {item.name}
                      </div>
                      <div className="text-xs text-zinc-600">{item.description}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Лог */}
        {showLog && (
          <div className="w-80 max-h-44 overflow-hidden pointer-events-none">
            <div className="space-y-1">
              {recentEvents.map((e, i) => (
                <div
                  key={i}
                  className="text-xs px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm"
                  style={{
                    color: e.type === 'ai_create' ? '#88ffaa' : e.type === 'ai_update' ? '#ffdd88' : e.type === 'world' ? '#aaaaff' : '#ffffff',
                    opacity: 1 - i * 0.1,
                  }}
                >
                  {e.message}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* HUD правый верхний */}
      <div className="absolute top-4 right-4 flex flex-col items-end gap-2 pointer-events-auto">
        <div className="text-xs text-white/50 bg-black/40 px-2 py-1 rounded">
          Поколение {currentWorld?.worldState.generation ?? 0}
        </div>
        <div className="text-xs text-white/50 bg-black/40 px-2 py-1 rounded">
          Существ: {currentWorld?.worldState.entities.length ?? 0}
        </div>
        {items.length > 0 && (
          <div className="text-xs text-white/40 bg-black/40 px-2 py-1 rounded">
            📦 {items.length} предмет{items.length === 1 ? '' : items.length < 5 ? 'а' : 'ов'}
          </div>
        )}
        {aiThinking && (
          <div className="text-xs text-green-400/80 bg-black/40 px-2 py-1 rounded animate-pulse">
            ИИ думает...
          </div>
        )}
        {!aiThinking && lastAiAction && (
          <div className="text-xs text-green-300/60 bg-black/40 px-2 py-1 rounded max-w-[180px] truncate">
            ↳ {lastAiAction}
          </div>
        )}
        <button
          onClick={() => setShowLog(!showLog)}
          className="text-xs text-white/40 bg-black/40 px-2 py-1 rounded hover:text-white/70"
        >
          {showLog ? 'Скрыть лог' : 'Лог'}
        </button>
        <button
          onClick={() => setPaused(true)}
          className="text-xs text-white/40 bg-black/40 px-2 py-1 rounded hover:text-white/70"
        >
          Пауза
        </button>
      </div>

      {/* Пауза */}
      {paused && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-8 w-64 flex flex-col gap-4">
            <div className="text-white text-xl font-light tracking-widest text-center">ПАУЗА</div>
            {/* Состояние мира */}
            <div className="text-xs text-zinc-600 text-center space-y-0.5">
              <div>Поколение {currentWorld?.worldState.generation ?? 0} · {currentWorld?.worldState.entities.length ?? 0} существ</div>
              {items.length > 0 && <div>📦 {items.length} предметов</div>}
              {activeEffects.length > 0 && <div>✨ {activeEffects.length} эффект{activeEffects.length === 1 ? '' : 'ов'}</div>}
            </div>
            <button
              onClick={() => { setPaused(false); engineRef.current?.requestPointerLock() }}
              className="w-full py-2 rounded-lg bg-emerald-900/60 hover:bg-emerald-800/60 text-emerald-300 text-sm transition-colors"
            >
              Продолжить
            </button>
            <button
              onClick={async () => {
                const latestWorld = useGameStore.getState().currentWorld
                if (latestWorld) await saveManager.saveWorld(latestWorld).catch(() => {})
                onExit()
              }}
              className="w-full py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white/60 text-sm transition-colors"
            >
              Выйти в меню
            </button>
          </div>
        </div>
      )}

      {!paused && (
        <div className="absolute bottom-4 right-4 text-xs text-white/20 pointer-events-none">
          ЛКМ — захват мыши · ESC — пауза
        </div>
      )}
    </div>
  )
}
