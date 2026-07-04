import { useEffect, useMemo, useRef, useState } from 'react'
import { saveManager, type WorldSave } from '../store/saveManager'
import { genesisAI, GenesisAI } from '../ai/GenesisAI'
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

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m > 0) return `${m} мин ${s} сек`
  return `${s} сек`
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
  const [resettingAI, setResettingAI] = useState(false)
  const [confirmFullReset, setConfirmFullReset] = useState(false)
  const [fullResetting, setFullResetting] = useState(false)

  // таймер загрузки
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const downloadStartRef = useRef<number | null>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const progressRef = useRef(0)

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
    return () => stopTimer()
  }, [])

  function startTimer() {
    if (elapsedTimerRef.current) return
    downloadStartRef.current = Date.now()
    setElapsedSeconds(0)
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - downloadStartRef.current!) / 1000))
    }, 1000)
  }

  function stopTimer() {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
    downloadStartRef.current = null
    setElapsedSeconds(0)
  }

  // Оценка оставшегося времени на основе скорости прогресса
  function getETA(): string | null {
    if (progressRef.current < 2 || elapsedSeconds < 3) return null
    const rate = progressRef.current / elapsedSeconds // % в секунду
    if (rate <= 0) return null
    const remaining = Math.round((100 - progressRef.current) / rate)
    if (remaining <= 0) return null
    const m = Math.floor(remaining / 60)
    const s = remaining % 60
    if (m >= 60) return `~${Math.floor(m / 60)} ч ${m % 60} мин`
    if (m > 0) return `~${m} мин ${s} сек`
    return `~${s} сек`
  }

  async function loadWorlds() {
    setLoading(true)
    const list = await saveManager.listWorlds()
    setWorlds(list)
    setLoading(false)
  }

  async function initAI() {
    setAiStatus('loading')
    setAiProgress(0)
    setAiMessage('')
    progressRef.current = 0
    stopTimer()
    startTimer()
    try {
      await genesisAI.initialize((progress, message) => {
        progressRef.current = progress
        setAiProgress(progress)
        setAiMessage(message)
      })
      stopTimer()
      setAiStatus('ready')
      setAiReady(true)
    } catch (e) {
      console.error('AI init failed:', e)
      stopTimer()
      setAiStatus('error')
    }
  }

  async function handleResetAI() {
    setResettingAI(true)
    try {
      await GenesisAI.clearCache()
      genesisAI.reset()
      setAiReady(false)
    } finally {
      setResettingAI(false)
    }
    initAI()
  }

  async function handleFullReset() {
    setFullResetting(true)
    try {
      await GenesisAI.clearCache()
      genesisAI.reset()
      await saveManager.deleteAllWorlds()
    } finally {
      setFullResetting(false)
      setConfirmFullReset(false)
    }
    window.location.reload()
  }

  function getAiErrorText(): string {
    const err = genesisAI.lastInitError
    if (err === 'webgpu_not_supported') return 'WebGPU недоступен — обновите драйверы видеокарты или запустите игру заново'
    if (err === 'webgpu_no_adapter') return 'Видеокарта не поддерживает WebGPU — нужна DirectX 12 совместимая GPU'
    if (err === 'network_error') return 'Ошибка сети при загрузке модели — проверьте интернет и перезапустите'
    if (err === 'cache_error') return 'Ошибка кэша браузера — нажмите «Удалить кэш и перескачать» ниже'
    return 'Ошибка ИИ — удалите кэш и попробуйте снова'
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
  const eta = getETA()

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

        {/* AI статус блок */}
        <div className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl px-4 py-3 flex items-start gap-3">
          <div
            className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${
              aiStatus === 'ready' ? 'bg-emerald-400' :
              aiStatus === 'loading' ? 'bg-yellow-400 animate-pulse' :
              aiStatus === 'error' ? 'bg-red-400' : 'bg-zinc-600'
            }`}
          />
          <div className="flex-1 min-w-0">

            {aiStatus === 'loading' && (
              <>
                {/* Текст текущей операции с анимированными точками */}
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-xs text-zinc-300 truncate">
                    {aiMessage || 'Загрузка ИИ-модели...'}
                  </span>
                  <LoadingDots />
                </div>

                {/* Прогресс-бар */}
                <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-1.5">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500 rounded-full"
                    style={{ width: `${Math.max(aiProgress, 0.5)}%` }}
                  />
                </div>

                {/* Нижняя строка: прогресс + таймер + ETA */}
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3 text-zinc-500">
                    <span className="text-zinc-300 font-mono">{aiProgress}%</span>
                    {elapsedSeconds > 0 && (
                      <span className="text-zinc-600">
                        прошло {formatElapsed(elapsedSeconds)}
                      </span>
                    )}
                  </div>
                  <div className="text-zinc-500 text-right">
                    {eta ? (
                      <span className="text-zinc-400">осталось {eta}</span>
                    ) : elapsedSeconds > 5 ? (
                      <span className="text-zinc-700">оцениваем время...</span>
                    ) : (
                      <span className="text-zinc-700">Первый запуск: несколько минут</span>
                    )}
                  </div>
                </div>
              </>
            )}

            {aiStatus === 'ready' && (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-xs text-emerald-400">ИИ готов — Genesis может думать</div>
                <button
                  onClick={handleResetAI}
                  disabled={resettingAI}
                  className="text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-800/60 hover:bg-zinc-700/60 border border-zinc-700 rounded px-2 py-1 transition-colors disabled:opacity-40 flex-shrink-0"
                >
                  {resettingAI ? 'Удаление...' : '↻ Удалить кэш и перескачать'}
                </button>
              </div>
            )}

            {aiStatus === 'error' && (
              <div className="flex flex-col gap-2">
                <div className="text-xs text-red-400">{getAiErrorText()}</div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={initAI}
                    className="text-xs text-yellow-300 bg-yellow-900/30 hover:bg-yellow-800/40 border border-yellow-800/50 rounded px-3 py-1.5 transition-colors"
                  >
                    ↻ Повторить загрузку
                  </button>
                  <button
                    onClick={handleResetAI}
                    disabled={resettingAI}
                    className="text-xs text-orange-300 bg-orange-900/30 hover:bg-orange-800/40 border border-orange-800/50 rounded px-3 py-1.5 transition-colors disabled:opacity-40"
                  >
                    {resettingAI ? 'Удаление...' : '🗑 Удалить кэш и перескачать'}
                  </button>
                </div>
              </div>
            )}

            {aiStatus === 'idle' && (
              <div className="text-xs text-zinc-500">Инициализация...</div>
            )}
          </div>
        </div>

        {/* Список миров */}
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

        {/* Полный сброс */}
        <button
          onClick={() => setConfirmFullReset(true)}
          className="text-zinc-700 hover:text-red-500 text-xs transition-colors"
        >
          ⚠ Полный сброс (удалить миры и нейросеть)
        </button>
      </div>

      {/* Диалог подтверждения полного сброса */}
      {confirmFullReset && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-20">
          <div className="bg-zinc-900 border border-red-900/60 rounded-xl p-6 w-80 flex flex-col gap-4 mx-4">
            <div className="text-white text-sm font-medium">Полный сброс</div>
            <p className="text-zinc-400 text-xs leading-relaxed">
              Это удалит <span className="text-white">все миры</span> и <span className="text-white">кэш нейросети</span> из браузера. После сброса нейросеть придётся скачать заново.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleFullReset}
                disabled={fullResetting}
                className="flex-1 py-2 rounded-lg bg-red-900/60 hover:bg-red-800/60 text-red-300 text-sm transition-colors disabled:opacity-40"
              >
                {fullResetting ? 'Удаление...' : 'Удалить всё'}
              </button>
              <button
                onClick={() => setConfirmFullReset(false)}
                disabled={fullResetting}
                className="flex-1 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm transition-colors disabled:opacity-40"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Анимированные точки — показывают что загрузка идёт активно
function LoadingDots() {
  return (
    <span className="inline-flex gap-[3px] items-center flex-shrink-0">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="block w-[3px] h-[3px] rounded-full bg-zinc-500"
          style={{
            animation: 'dotPulse 1.4s ease-in-out infinite',
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
      <style>{`
        @keyframes dotPulse {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </span>
  )
}
