import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { saveManager, type WorldSave } from '../store/saveManager'
import { genesisAI, GenesisAI } from '../ai/GenesisAI'
import { exportModel, importModel, getModelCacheSize, formatBytes, type StorageProgress } from '../ai/ModelStorage'
import { useGameStore } from '../store/gameStore'

interface Props {
  onEnterWorld: (world: WorldSave) => void
}

type Phase = 'loading' | 'success' | 'menu' | 'error'

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
  const [aiRawError, setAiRawError] = useState<string | null>(null)
  const [showRawError, setShowRawError] = useState(false)
  const [resettingAI, setResettingAI] = useState(false)
  const [confirmFullReset, setConfirmFullReset] = useState(false)
  const [fullResetting, setFullResetting] = useState(false)
  const [phase, setPhase] = useState<Phase>('loading')

  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const downloadStartRef = useRef<number | null>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const progressRef = useRef(0)
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Model storage (export / import) ──────────────────────────────────────
  type StorageOp = 'export' | 'import' | null
  const [storageOp, setStorageOp]         = useState<StorageOp>(null)
  const [storageProgress, setStorageProgress] = useState<StorageProgress | null>(null)
  const [storageError, setStorageError]   = useState<string | null>(null)
  const [storageDone, setStorageDone]     = useState(false)
  const [modelCacheSize, setModelCacheSize] = useState(0)
  const importInputRef = useRef<HTMLInputElement>(null)

  const { setCurrentWorld, setAiReady } = useGameStore()

  // Refresh cache size badge whenever model status changes
  useEffect(() => {
    getModelCacheSize().then(setModelCacheSize).catch(() => setModelCacheSize(0))
  }, [aiStatus])

  const stars = useMemo(
    () =>
      Array.from({ length: 80 }, () => ({
        size: Math.random() * 2.5 + 0.5,
        left: Math.random() * 100,
        top: Math.random() * 100,
        opacity: Math.random() * 0.5 + 0.05,
        delay: Math.random() * 4,
      })),
    []
  )

  useEffect(() => {
    loadWorlds()
    initAI()
    return () => {
      stopTimer()
      if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (aiStatus === 'ready') {
      setPhase('success')
      phaseTimerRef.current = setTimeout(() => setPhase('menu'), 900)
    } else if (aiStatus === 'error') {
      setPhase('error')
    }
  }, [aiStatus])

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

  function getETA(): string | null {
    if (progressRef.current < 2 || elapsedSeconds < 3) return null
    const rate = progressRef.current / elapsedSeconds
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
    setAiRawError(null)
    setShowRawError(false)
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
      const raw = genesisAI.lastRawError
        || (e instanceof Error ? `[${e.name}] ${e.message}` : String(e))
      setAiRawError(raw)
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
    setPhase('loading')
    initAI()
  }

  async function handleFullReset() {
    setFullResetting(true)
    try {
      await saveManager.deleteAllWorlds()
      await GenesisAI.clearCache()
      genesisAI.reset()
      setAiReady(false)
    } finally {
      setFullResetting(false)
      setConfirmFullReset(false)
    }
    window.location.reload()
  }

  // ── Storage handlers ─────────────────────────────────────────────────────

  function openStorageModal(op: 'export' | 'import') {
    setStorageOp(op)
    setStorageProgress(null)
    setStorageError(null)
    setStorageDone(false)
  }

  function closeStorageModal() {
    setStorageOp(null)
    setStorageProgress(null)
    setStorageError(null)
    setStorageDone(false)
  }

  async function handleExport() {
    openStorageModal('export')
    try {
      await exportModel((p) => setStorageProgress(p))
      setStorageDone(true)
    } catch (e) {
      setStorageError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleImportFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''  // reset so same file can be re-selected
    openStorageModal('import')
    try {
      await importModel(file, (p) => setStorageProgress(p))
      setStorageDone(true)
      // Re-init AI from the freshly restored cache
      genesisAI.reset()
      setAiReady(false)
      setPhase('loading')
      closeStorageModal()
      initAI()
    } catch (e) {
      setStorageError(e instanceof Error ? e.message : String(e))
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
  const eta = getETA()
  const isLoadingPhase = phase === 'loading' || phase === 'success'

  // Stagger variants for menu buttons
  const containerVariants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
  }
  const itemVariants = {
    hidden: { scaleY: 0.08, opacity: 0 },
    show: {
      scaleY: 1,
      opacity: 1,
      transition: { type: 'spring' as const, stiffness: 380, damping: 28 },
    },
  }

  return (
    <div className="relative min-h-screen bg-black text-white overflow-hidden">

      {/* ── Starfield ── */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {stars.map((star, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              width: star.size,
              height: star.size,
              left: `${star.left}%`,
              top: `${star.top}%`,
              opacity: star.opacity,
              animation: `twinkle ${3 + star.delay}s ease-in-out infinite`,
              animationDelay: `${star.delay}s`,
            }}
          />
        ))}
      </div>

      {/* ── LOADING OVERLAY ── full screen, hides when phase → menu */}
      <AnimatePresence>
        {isLoadingPhase && (
          <motion.div
            key="loading-overlay"
            className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-10"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.55, ease: 'easeInOut' } }}
          >
            {/* Deep vignette behind loading content */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_#060614_0%,_#000000_75%)]" />

            {/* Title */}
            <motion.div
              className="relative z-10 text-center"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            >
              <h1 className="text-8xl font-thin tracking-[0.35em] text-white">GENESIS</h1>
              <p className="text-zinc-600 text-sm tracking-[0.25em] mt-2">мир, который создаёт себя сам</p>
            </motion.div>

            {/* Progress bar zone */}
            <div className="relative z-10 flex flex-col items-center gap-4 w-full max-w-sm px-6">
              {/* Bar container */}
              <div className="relative w-full h-[6px] bg-zinc-900 rounded-full overflow-hidden">
                <motion.div
                  className="absolute left-0 top-0 h-full rounded-full"
                  animate={{
                    width: `${Math.max(aiProgress, 0.5)}%`,
                    backgroundColor: phase === 'success' ? '#34d399' : '#10b981',
                    boxShadow: phase === 'success'
                      ? '0 0 20px 4px rgba(52,211,153,0.7)'
                      : '0 0 8px 1px rgba(16,185,129,0.3)',
                  }}
                  transition={{ width: { duration: 0.4 }, boxShadow: { duration: 0.3 } }}
                />
                {/* Shimmer effect */}
                {phase === 'loading' && (
                  <div
                    className="absolute top-0 h-full w-12 bg-gradient-to-r from-transparent via-white/20 to-transparent rounded-full"
                    style={{ animation: 'shimmer 2s ease-in-out infinite', left: '-48px' }}
                  />
                )}
              </div>

              {/* Status line */}
              <AnimatePresence mode="wait">
                {phase === 'success' ? (
                  <motion.div
                    key="done"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2"
                  >
                    <span className="text-emerald-400 text-sm tracking-widest">Готово</span>
                  </motion.div>
                ) : (
                  <motion.div
                    key="progress"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center gap-1.5 text-center"
                  >
                    <div className="flex items-center gap-2 text-zinc-400 text-xs">
                      <span className="font-mono text-white/70">{aiProgress}%</span>
                      {elapsedSeconds > 0 && (
                        <span className="text-zinc-600">{formatElapsed(elapsedSeconds)}</span>
                      )}
                      {eta && <span className="text-zinc-500">· осталось {eta}</span>}
                    </div>
                    <div className="text-zinc-600 text-xs max-w-xs truncate px-2">
                      {aiMessage || 'Загрузка ИИ-модели...'}
                    </div>
                    {elapsedSeconds < 4 && !aiMessage && (
                      <div className="text-zinc-700 text-xs">Первый запуск: несколько минут</div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ─── Import button (visible 2 s after load starts) ─── */}
              {phase === 'loading' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 2 }}
                  className="relative z-10 flex flex-col items-center gap-1"
                >
                  <button
                    onClick={() => importInputRef.current?.click()}
                    className="text-xs text-zinc-600 hover:text-zinc-400 border border-zinc-800/60 hover:border-zinc-600 rounded-lg px-4 py-2 transition-all"
                  >
                    📂 Загрузить из сохранённого файла
                  </button>
                  <span className="text-zinc-800 text-[10px]">если уже сохраняли модель раньше</span>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── MAIN MENU ── appears after loading */}
      <AnimatePresence>
        {(phase === 'menu' || phase === 'error') && (
          <motion.div
            key="menu"
            className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 py-12"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_#07071a_0%,_#000000_70%)]" />

            <div className="relative z-10 w-full max-w-md flex flex-col items-center gap-8">

              {/* Title */}
              <motion.div
                className="text-center"
                initial={{ opacity: 0, y: -16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                <h1 className="text-6xl font-thin tracking-[0.3em] text-white">GENESIS</h1>
                <p className="text-zinc-600 text-xs tracking-widest mt-2">мир, который создаёт себя сам</p>
              </motion.div>

              {/* Error banner (only if error) */}
              {phase === 'error' && (
                <motion.div
                  initial={{ opacity: 0, scaleY: 0 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  className="w-full bg-red-950/40 border border-red-900/50 rounded-xl px-4 py-3 flex flex-col gap-2"
                >
                  <div className="text-xs text-red-400">
                    {genesisAI.lastInitError === 'network_error'
                      ? 'Ошибка сети — проверьте интернет'
                      : genesisAI.lastInitError === 'cache_error'
                      ? 'Переполнен кэш — удалите кэш и попробуйте снова'
                      : 'Ошибка загрузки ИИ'}
                  </div>
                  {aiRawError && (
                    <>
                      <button
                        onClick={() => setShowRawError(v => !v)}
                        className="self-start text-xs text-zinc-600 hover:text-zinc-400 underline underline-offset-2 transition-colors"
                      >
                        {showRawError ? 'Скрыть детали' : 'Показать детали'}
                      </button>
                      {showRawError && (
                        <div className="bg-black/60 border border-zinc-800 rounded px-2 py-1.5 text-xs font-mono text-zinc-400 break-all leading-relaxed max-h-20 overflow-y-auto select-text">
                          {aiRawError}
                        </div>
                      )}
                    </>
                  )}
                  <div className="flex gap-2 flex-wrap mt-1">
                    <button
                      onClick={() => { setPhase('loading'); initAI() }}
                      className="text-xs text-yellow-300 bg-yellow-900/30 hover:bg-yellow-800/40 border border-yellow-800/50 rounded px-3 py-1.5 transition-colors"
                    >
                      ↻ Повторить
                    </button>
                    {genesisAI.lastInitError !== 'network_error' && (
                      <button
                        onClick={handleResetAI}
                        disabled={resettingAI}
                        className="text-xs text-orange-300 bg-orange-900/30 hover:bg-orange-800/40 border border-orange-800/50 rounded px-3 py-1.5 transition-colors disabled:opacity-40"
                      >
                        {resettingAI ? 'Удаление...' : 'Удалить кэш'}
                      </button>
                    )}
                  </div>
                </motion.div>
              )}

              {/* ── ACTION ZONE: bar → buttons animation ── */}
              <motion.div
                className="w-full flex flex-col gap-2.5"
                variants={containerVariants}
                initial="hidden"
                animate="show"
              >
                {/* "Новый мир" button */}
                <motion.div
                  variants={itemVariants}
                  style={{ transformOrigin: 'center' }}
                >
                  {creating ? (
                    <div className="w-full bg-zinc-900/70 border border-zinc-700 rounded-xl p-4 flex flex-col gap-3">
                      <input
                        autoFocus
                        type="text"
                        placeholder="Название мира..."
                        value={newWorldName}
                        onChange={e => setNewWorldName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleNewWorld()
                          if (e.key === 'Escape') setCreating(false)
                        }}
                        className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-zinc-500 w-full"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleNewWorld}
                          className="flex-1 py-2 rounded-lg bg-emerald-900/60 hover:bg-emerald-800/60 text-emerald-300 text-sm transition-colors"
                        >
                          Создать
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
                      className="w-full py-3.5 rounded-xl border border-emerald-900/50 bg-emerald-950/25 hover:bg-emerald-900/30 text-emerald-400 hover:text-emerald-300 text-sm tracking-widest uppercase transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      + Новый мир
                    </button>
                  )}
                </motion.div>

                {/* Saved worlds */}
                {loading ? (
                  <motion.div variants={itemVariants} style={{ transformOrigin: 'center' }}>
                    <div className="w-full py-3 rounded-xl border border-zinc-800 bg-zinc-900/20 text-center text-zinc-700 text-xs">
                      Загрузка миров...
                    </div>
                  </motion.div>
                ) : worlds.length === 0 ? (
                  <motion.div variants={itemVariants} style={{ transformOrigin: 'center' }}>
                    <div className="w-full py-6 rounded-xl border border-dashed border-zinc-800/60 text-center text-zinc-700 text-xs">
                      Нет сохранённых миров
                    </div>
                  </motion.div>
                ) : (
                  worlds.map(world => (
                    <motion.div
                      key={world.id}
                      variants={itemVariants}
                      style={{ transformOrigin: 'center' }}
                    >
                      <div
                        className="group flex items-center gap-3 bg-zinc-900/50 hover:bg-zinc-800/50 border border-zinc-800 hover:border-zinc-700 rounded-xl px-4 py-3 transition-all cursor-pointer"
                        onClick={() => deleting !== world.id && handleEnterWorld(world)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-white text-sm font-medium truncate">{world.name}</div>
                          <div className="text-zinc-600 text-xs flex gap-2.5 mt-0.5 flex-wrap">
                            <span>Поколение {world.worldState.generation}</span>
                            <span>{world.worldState.entities.length} существ</span>
                            <span>{formatTime(world.playTimeSeconds)}</span>
                            <span>{formatDate(world.lastPlayedAt)}</span>
                          </div>
                        </div>
                        {deleting === world.id ? (
                          <div className="flex gap-1.5 flex-shrink-0">
                            <button
                              onClick={e => { e.stopPropagation(); handleDelete(world.id) }}
                              className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded border border-red-900 hover:border-red-700 transition-colors"
                            >
                              Удалить
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); setDeleting(null) }}
                              className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded border border-zinc-700 transition-colors"
                            >
                              Отмена
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={e => { e.stopPropagation(); setDeleting(world.id) }}
                            className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 text-xs px-2 py-1 transition-all"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </motion.div>
                  ))
                )}
              </motion.div>

              {/* AI mode badge + save/reset — only shown when AI loaded successfully */}
              {aiStatus === 'ready' && (
                <motion.div
                  className="flex flex-col gap-2 w-full"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span className="text-xs text-zinc-600">ИИ готов</span>
                      {modelCacheSize > 0 && (
                        <span className="text-zinc-700 text-xs">{formatBytes(modelCacheSize)}</span>
                      )}
                      {genesisAI.activeBackend === 'wasm' && (
                        <span className="text-xs text-yellow-500 bg-yellow-900/20 border border-yellow-800/30 rounded px-1.5 py-0.5">
                          CPU режим
                        </span>
                      )}
                    </div>
                    <button
                      onClick={handleResetAI}
                      disabled={resettingAI}
                      className="text-xs text-zinc-700 hover:text-zinc-400 transition-colors disabled:opacity-40"
                    >
                      {resettingAI ? 'Удаление...' : '↻ Сбросить кэш'}
                    </button>
                  </div>

                  {/* Save model button */}
                  <button
                    onClick={handleExport}
                    className="w-full py-2.5 rounded-xl border border-zinc-800/60 hover:border-zinc-600 bg-zinc-900/30 hover:bg-zinc-800/40 text-zinc-500 hover:text-zinc-300 text-xs tracking-wide transition-all flex items-center justify-center gap-2"
                  >
                    <span>💾</span>
                    <span>Сохранить модель на диск</span>
                    {modelCacheSize > 0 && (
                      <span className="text-zinc-700">· {formatBytes(modelCacheSize)}</span>
                    )}
                  </button>
                </motion.div>
              )}

              {/* Footer */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="text-center"
              >
                <p className="text-zinc-800 text-xs">
                  Нажмите на мир чтобы войти · ИИ начнёт творить через несколько секунд
                </p>
                <button
                  onClick={() => setConfirmFullReset(true)}
                  className="mt-3 text-zinc-800 hover:text-red-600 text-xs transition-colors"
                >
                  ⚠ Полный сброс
                </button>
              </motion.div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Hidden file input for model import ── */}
      <input
        ref={importInputRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={handleImportFileSelected}
      />

      {/* ── Storage operation progress modal (export / import) ── */}
      <AnimatePresence>
        {storageOp !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-50"
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 w-80 flex flex-col gap-4 mx-4"
            >
              <div className="text-white text-sm font-medium">
                {storageOp === 'export' ? '💾 Сохранение модели' : '📂 Загрузка из файла'}
              </div>

              {/* Progress bar */}
              {!storageError && (
                <div className="flex flex-col gap-2">
                  <div className="relative w-full h-[5px] bg-zinc-800 rounded-full overflow-hidden">
                    <motion.div
                      className="absolute left-0 top-0 h-full rounded-full bg-emerald-500"
                      animate={{
                        width: storageDone
                          ? '100%'
                          : storageProgress && storageProgress.total > 0
                          ? `${Math.round((storageProgress.current / storageProgress.total) * 100)}%`
                          : '4%',
                        backgroundColor: storageDone ? '#34d399' : '#10b981',
                      }}
                      transition={{ width: { duration: 0.3 } }}
                    />
                    {!storageDone && (
                      <div
                        className="absolute top-0 h-full w-10 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                        style={{ animation: 'shimmer 1.8s ease-in-out infinite', left: '-40px' }}
                      />
                    )}
                  </div>
                  <div className="text-zinc-500 text-xs truncate">
                    {storageDone
                      ? (storageOp === 'export' ? 'Файл скачан — проверьте папку загрузок' : 'Готово, ИИ переинициализируется…')
                      : storageProgress?.step ?? (storageOp === 'export' ? 'Подготовка…' : 'Чтение файла…')}
                  </div>
                  {storageProgress && storageProgress.total > 0 && !storageDone && (
                    <div className="text-zinc-700 text-xs">
                      {storageProgress.current} / {storageProgress.total}
                    </div>
                  )}
                </div>
              )}

              {/* Error */}
              {storageError && (
                <div className="bg-red-950/40 border border-red-900/40 rounded-lg px-3 py-2 text-red-400 text-xs leading-relaxed whitespace-pre-line">
                  {storageError}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                {storageDone && (
                  <button
                    onClick={closeStorageModal}
                    className="flex-1 py-2 rounded-lg bg-emerald-900/50 hover:bg-emerald-800/50 text-emerald-300 text-sm transition-colors"
                  >
                    ОК
                  </button>
                )}
                {(storageError || storageDone) && (
                  <button
                    onClick={closeStorageModal}
                    className="flex-1 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm transition-colors"
                  >
                    Закрыть
                  </button>
                )}
                {!storageDone && !storageError && (
                  <div className="flex-1 py-2 rounded-lg bg-zinc-800/40 text-zinc-600 text-sm text-center select-none">
                    {storageOp === 'export' ? 'Упаковка…' : 'Восстановление…'}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Full reset confirm dialog ── */}
      <AnimatePresence>
        {confirmFullReset && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-zinc-900 border border-red-900/50 rounded-xl p-6 w-80 flex flex-col gap-4 mx-4"
            >
              <div className="text-white text-sm font-medium">Полный сброс</div>
              <p className="text-zinc-400 text-xs leading-relaxed">
                Удалит <span className="text-white">все миры</span> и{' '}
                <span className="text-white">кэш нейросети</span>. После сброса нейросеть придётся скачать заново.
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: var(--tw-opacity, 0.3); }
          50% { opacity: 0.08; }
        }
        @keyframes shimmer {
          0% { left: -48px; }
          100% { left: calc(100% + 48px); }
        }
      `}</style>
    </div>
  )
}
