import { useEffect, useRef, useState, useCallback } from 'react'
import { GameEngine } from '../engine/GameEngine'
import { genesisAI } from '../ai/GenesisAI'
import { useGameStore } from '../store/gameStore'
import { saveManager } from '../store/saveManager'
import type { EntityData, MechanicData } from '../store/saveManager'

interface Props {
  onExit: () => void
}

const AI_INTERVAL_MS = 45_000

export default function GameView({ onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<GameEngine | null>(null)
  const aiIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const saveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Use a ref for the "is thinking" guard — keeps it out of useCallback deps
  // so the interval never gets reset mid-cycle
  const aiThinkingRef = useRef(false)
  // Stable ref to the latest runAITick; the interval always calls through this
  // so it never holds a stale closure
  const runAITickRef = useRef<() => void>(() => {})

  const [paused, setPaused] = useState(false)
  const [showLog, setShowLog] = useState(true)
  const [aiThinking, setAiThinking] = useState(false)
  const [lastAiAction, setLastAiAction] = useState<string>('')

  const {
    currentWorld, addEvent, addEntity, removeEntity,
    updateEntity, addMechanic, addTerrainMod, updateAiMemory,
    incrementGeneration, updatePlayTime, aiReady,
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
            position: command.entity.position || [
              (Math.random() - 0.5) * 80, 0, (Math.random() - 0.5) * 80,
            ],
            generation: (command.entity.generation ?? 0) + 1,
          }
          addEntity(entity)
          engineRef.current?.spawnEntity(entity)
          addEvent({ message: `ИИ создал: ${entity.name} — ${entity.behavior}`, type: 'ai_create' })
          setLastAiAction(`Создал: ${entity.name}`)
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
            // Persist the modification so it's saved and restored on reload
            addTerrainMod(mod)
            const names: Record<string, string> = {
              mountain: 'гора', cave: 'пещера', river: 'река', anomaly: 'аномалия',
            }
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
              ? position
              : [(Math.random() - 0.5) * 100, 0, (Math.random() - 0.5) * 100]
            engineRef.current?.spawnStructure(name, type, pos, parts)
            const mode = parts && parts.length > 0 ? 'custom' : type
            addEvent({ message: `ИИ построил: ${name} (${mode}, ${parts?.length ?? 0} частей)`, type: 'ai_create' })
            setLastAiAction(`Постройка: ${name}`)
          }
          break
        }

        case 'start_event': {
          addEvent({ message: `Событие: ${command.name} — ${command.description}`, type: 'world' })
          setLastAiAction(`Событие: ${command.name}`)
          break
        }

        case 'player_ability': {
          addEvent({ message: `Способность: ${command.ability} — ${command.description}`, type: 'ai_create' })
          setLastAiAction(`Способность: ${command.ability}`)
          break
        }

        case 'world_message': {
          addEvent({ message: `Мир: ${command.message}`, type: 'world' })
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
  }, [currentWorld, aiReady, addEntity, addEvent, addMechanic, addTerrainMod, incrementGeneration, removeEntity, updateAiMemory, updateEntity])
  // NOTE: aiThinking intentionally removed from deps — we use aiThinkingRef for the guard

  // Keep the ref always pointing to the latest version of runAITick
  useEffect(() => { runAITickRef.current = runAITick }, [runAITick])

  // Mount: start engine + intervals. Uses runAITickRef so no stale closures.
  useEffect(() => {
    if (!canvasRef.current || !currentWorld) return
    const engine = new GameEngine(canvasRef.current, currentWorld, () => setPaused(true))
    engineRef.current = engine
    engine.start()
    aiIntervalRef.current = setInterval(() => runAITickRef.current(), AI_INTERVAL_MS)
    saveIntervalRef.current = setInterval(async () => {
      // Use getState() to always get the latest world, never a stale closure snapshot
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

  // Fire immediately when AI becomes ready
  useEffect(() => {
    if (aiReady && engineRef.current) setTimeout(() => runAITickRef.current(), 2000)
  }, [aiReady]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pause / resume: only recreate the interval when pause state changes,
  // NOT on every runAITick reference change (that was the timer-reset bug)
  useEffect(() => {
    if (aiIntervalRef.current) clearInterval(aiIntervalRef.current)
    if (!paused) aiIntervalRef.current = setInterval(() => runAITickRef.current(), AI_INTERVAL_MS)
  }, [paused])

  const recentEvents = currentWorld?.worldState.eventLog.slice(0, 8) ?? []

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

      {/* Лог */}
      {showLog && (
        <div className="absolute bottom-4 left-4 w-80 max-h-52 overflow-hidden pointer-events-none">
          <div className="space-y-1">
            {recentEvents.map((e, i) => (
              <div
                key={i}
                className="text-xs px-2 py-1 rounded bg-black/60 backdrop-blur-sm"
                style={{
                  color:
                    e.type === 'ai_create' ? '#88ffaa' :
                    e.type === 'ai_update' ? '#ffdd88' :
                    e.type === 'world'     ? '#aaaaff' : '#ffffff',
                  opacity: 1 - i * 0.1,
                }}
              >
                {e.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* HUD */}
      <div className="absolute top-4 right-4 flex flex-col items-end gap-2 pointer-events-auto">
        <div className="text-xs text-white/50 bg-black/40 px-2 py-1 rounded">
          Поколение {currentWorld?.worldState.generation ?? 0}
        </div>
        <div className="text-xs text-white/50 bg-black/40 px-2 py-1 rounded">
          Существ: {currentWorld?.worldState.entities.length ?? 0}
        </div>
        {aiThinking && (
          <div className="text-xs text-green-400/80 bg-black/40 px-2 py-1 rounded animate-pulse">
            ИИ думает...
          </div>
        )}
        {!aiThinking && lastAiAction && (
          <div className="text-xs text-green-300/60 bg-black/40 px-2 py-1 rounded max-w-[160px] truncate">
            ↳ {lastAiAction}
          </div>
        )}
        <button
          onClick={() => setShowLog(!showLog)}
          className="text.xs text-white/40 bg-black/40 px-2 py-1 rounded hover:text-white/70"
        >
          {showLog ? 'Скрыть лог' : 'Показать лог'}
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
            <button
              onClick={() => { setPaused(false); engineRef.current?.requestPointerLock() }}
              className="w-full py-2 rounded-lg bg-emerald-900/60 hover:bg-emerald-800/60 text-emerald-300 text-sm transition-colors"
            >
              Продолжить
            </button>
            <button
              onClick={async () => {
                if (currentWorld) await saveManager.saveWorld(currentWorld).catch(() => {})
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
