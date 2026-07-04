import { useEffect, useMemo, useState } from 'react'
import { saveManager, type WorldSave } from '../store/saveManager'
import { genesisAI } from '../ai/GenesisAI'
import { useGameStore } from '../store/gameStore'

interface Props {
  onEnterWorld: (world: WorldSave) => void
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}ч ${m}м`
  if (m > 0) return `${m} мин`
  return 'только начало'
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function MainMenu({ onEnterWorld }: Props) {
  const [worlds, setWorlds] = useState<WorldSave[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newWorldName, setNewWorldName] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [aiProgress, setAiProgress] = useState(0)
  const [aiMessage, setAiMessage] = useState('')
  const { setCurrentWorld, setAiReady } = useGameStore()

  const stars = useMemo(
    () =>
      Array.from({ length: 60 }, () => ({
        size: Math.random() * 2 + 0.5,
        left: Math.random() * 100,
        top: Math.random() * 100,
        opacity: Math.random() * 0.6 + 0.1,
      })),
    []
  )

  useEffect(() => {
    loadWorlds()
    initAI()
  }, [])

  async function loadWorlds() {
    setLoading(true)
    const list = await saveManager.listWorlds()
    setWorlds(list)
    setLoading(false)
  }

  async function initAI() {
    setAiStatus('loading')
    try {
      await genesisAI.initialize((progress, message) => {
        setAiProgress(progress)
        setAiMessage(message)
      })
      setAiStatus('ready')
      setAiReady(true)
    } catch (e) {
      console.error('AI init failed:', e)
      setAiStatus('error')
    }
  }

  async function handleNewWorld() {
    const name = newWorldName.trim() || `Мир ${worlds.length + 1}`
    const world = saveManager.createNewWorld(name)
    await saveManager.saveWorld(world)
    await loadWorlds()
    setCreating(false)
    setNewWorldName('')
    handleEnterWorld(world)
  }

  function handleEnterWorld(world: WorldSave) {
    setCurrentWorld(world)
    onEnterWorld(world)
  }

  async function handleDelete(id: string) {
    await saveManager.deleteWorld(id)
    setDeleting(null)
    loadWorlds()
  }

  const canCreate = worlds.length < 20

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_#0a0a2a_0%,_#000000_70%)]" />

      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {stars.map((star, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              width: star.size + 'px',
              height: star.size + 'px',
              left: star.left + '%',
              top: star.top + '%',
              opacity: star.opacity,
            }}
          />
        ))}
      </div>

      <div className="relative z-10 w-full max-w-2xl px-6 flex flex-col items-center gap-8">
        <div className="text-center">
          <h1 className="text-7xl font-thin tracking-[0.3em] text-white mb-2">GENESIS</h1>
          <p className="text-zinc-500 text-sm tracking-widest">мир, который создаёт себя сам</p>
        </div>

        <div className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl px-4 py-3 flex items-center gap-3">
          <div
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              aiStatus === 'ready' ? 'bg-emerald-400' :
              aiStatus === 'loading' ? 'bg-yellow-400 animate-pulse' :
              aiStatus === 'error' ? 'bg-red-400' : 'bg-zinc-600'
            }`}
          />
          <div className="flex-1 min-w-0">
            {aiStatus === 'loading' && (
              <>
                <div className="text-xs text-zinc-400 mb-1 truncate">{aiMessage || 'Загрузка ИИ-модели...'}</div>
                <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
                    style={{ width: `${aiProgress}%` }}
                  />
                </div>
                <div className="text-xs text-zinc-600 mt-1">{aiProgress}% · Первый запуск может занять несколько минут</div>
              </>
            )}
            {aiStatus === 'ready' && (
              <div className="text-xs text-emerald-400">ИИ готов — Genesis может думать</div>
            )}
            {aiStatus === 'error' && (
              <div className="text-xs text-red-400">Ошибка ИИ — нужна поддержка WebGPU (Chrome/Edge)</div>
            )}
            {aiStatus === 'idle' && (
              <div className="text-xs text-zinc-500">Инициализация...</div>
            )}
          </div>
        </div>

        <div className="w-full">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-zinc-400 text-xs tracking-widest uppercase">Миры</h2>
            <span className="text-zinc-600 text-xs">{worlds.length}/20</span>
          </div>

          {loading ? (
            <div className="text-center text-zinc-600 text-sm py-8">Загрузка...</div>
          ) : worlds.length === 0 ? (
            <div className="text-center text-zinc-600 text-sm py-8 border border-dashed border-zinc-800 rounded-xl">
              Нет сохранённых миров
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {worlds.map((world) => (
                <div
                  key={world.id}
                  className="group flex items-center gap-3 bg-zinc-900/50 hover:bg-zinc-800/50 border border-zinc-800 hover:border-zinc-700 rounded-lg px-4 py-3 transition-all cursor-pointer"
                  onClick={() => deleting !== world.id && handleEnterWorld(world)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium truncate">{world.name}</div>
                    <div className="text-zinc-500 text-xs flex gap-3 mt-0.5">
                      <span>Поколение {world.worldState.generation}</span>
                      <span>{world.worldState.entities.length} существ</span>
                      <span>{formatTime(world.playTimeSeconds)}</span>
                      <span>{formatDate(world.lastPlayedAt)}</span>
                    </div>
                  </div>
                  {deleting === world.id ? (
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(world.id) }}
                        className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded border border-red-900 hover:border-red-700 transition-colors"
                      >
                        Удалить
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleting(null) }}
                        className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded border border-zinc-700 transition-colors"
                      >
                        Отмена
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleting(world.id) }}
                      className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 text-xs px-2 py-1 transition-all"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {creating ? (
          <div className="w-full bg-zinc-900/60 border border-zinc-700 rounded-xl p-4 flex flex-col gap-3">
            <input
              autoFocus
              type="text"
              placeholder="Название мира..."
              value={newWorldName}
              onChange={(e) => setNewWorldName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleNewWorld(); if (e.key === 'Escape') setCreating(false) }}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-zinc-500 w-full"
            />
            <div className="flex gap-2">
              <button
                onClick={handleNewWorld}
                className="flex-1 py-2 rounded-lg bg-emerald-900/60 hover:bg-emerald-800/60 text-emerald-300 text-sm transition-colors"
              >
                Создать мир
              </button>
              <button
                onClick={() => { setCreating(false); setNewWorldName('') }}
                className="flex-1 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm transition-colors"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            disabled={!canCreate}
            className="w-full py-3 rounded-xl border border-emerald-900/60 bg-emerald-950/30 hover:bg-emerald-900/30 text-emerald-400 hover:text-emerald-300 text-sm tracking-widest uppercase transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Новый мир
          </button>
        )}

        <p className="text-zinc-700 text-xs text-center">
          Нажмите на мир чтобы войти · ИИ начнёт творить через несколько секунд
        </p>
      </div>
    </div>
  )
}
