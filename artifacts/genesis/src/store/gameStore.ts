import { create } from 'zustand'
import type { WorldSave, WorldState, EventEntry, EntityData, MechanicData, TerrainModification } from './saveManager'

interface GameStore {
  currentWorld: WorldSave | null
  isLoading: boolean
  loadingMessage: string
  loadingProgress: number
  aiReady: boolean
  paused: boolean

  setCurrentWorld: (world: WorldSave) => void
  setLoading: (loading: boolean, message?: string, progress?: number) => void
  setAiReady: (ready: boolean) => void
  setPaused: (paused: boolean) => void

  addEvent: (entry: Omit<EventEntry, 'timestamp'>) => void
  addEntity: (entity: EntityData) => void
  updateEntity: (id: string, updates: Partial<EntityData>) => void
  removeEntity: (id: string) => void
  addMechanic: (mechanic: MechanicData) => void
  addTerrainMod: (mod: TerrainModification) => void
  updateAiMemory: (memory: string) => void
  incrementGeneration: () => void
  updatePlayTime: (seconds: number) => void
  getWorldState: () => WorldState | null
}

export const useGameStore = create<GameStore>((set, get) => ({
  currentWorld: null,
  isLoading: false,
  loadingMessage: '',
  loadingProgress: 0,
  aiReady: false,
  paused: false,

  setCurrentWorld: (world) => set({ currentWorld: world }),

  setLoading: (loading, message = '', progress = 0) =>
    set({ isLoading: loading, loadingMessage: message, loadingProgress: progress }),

  setAiReady: (ready) => set({ aiReady: ready }),
  setPaused: (paused) => set({ paused }),

  addEvent: (entry) =>
    set((state) => {
      if (!state.currentWorld) return state
      const event: EventEntry = { ...entry, timestamp: Date.now() }
      const eventLog = [event, ...state.currentWorld.worldState.eventLog].slice(0, 200)
      return {
        currentWorld: {
          ...state.currentWorld,
          worldState: { ...state.currentWorld.worldState, eventLog },
        },
      }
    }),

  addEntity: (entity) =>
    set((state) => {
      if (!state.currentWorld) return state
      const entities = [...state.currentWorld.worldState.entities, entity]
      return {
        currentWorld: {
          ...state.currentWorld,
          worldState: { ...state.currentWorld.worldState, entities },
        },
      }
    }),

  updateEntity: (id, updates) =>
    set((state) => {
      if (!state.currentWorld) return state
      const entities = state.currentWorld.worldState.entities.map((e) =>
        e.id === id ? { ...e, ...updates } : e
      )
      return {
        currentWorld: {
          ...state.currentWorld,
          worldState: { ...state.currentWorld.worldState, entities },
        },
      }
    }),

  removeEntity: (id) =>
    set((state) => {
      if (!state.currentWorld) return state
      const entities = state.currentWorld.worldState.entities.filter((e) => e.id !== id)
      return {
        currentWorld: {
          ...state.currentWorld,
          worldState: { ...state.currentWorld.worldState, entities },
        },
      }
    }),

  addMechanic: (mechanic) =>
    set((state) => {
      if (!state.currentWorld) return state
      const mechanics = [...state.currentWorld.worldState.mechanics, mechanic]
      return {
        currentWorld: {
          ...state.currentWorld,
          worldState: { ...state.currentWorld.worldState, mechanics },
        },
      }
    }),

  addTerrainMod: (mod) =>
    set((state) => {
      if (!state.currentWorld) return state
      const terrain = [...state.currentWorld.worldState.terrain, mod]
      return {
        currentWorld: {
          ...state.currentWorld,
          worldState: { ...state.currentWorld.worldState, terrain },
        },
      }
    }),

  updateAiMemory: (aiMemory) =>
    set((state) => {
      if (!state.currentWorld) return state
      return {
        currentWorld: {
          ...state.currentWorld,
          worldState: { ...state.currentWorld.worldState, aiMemory },
        },
      }
    }),

  incrementGeneration: () =>
    set((state) => {
      if (!state.currentWorld) return state
      return {
        currentWorld: {
          ...state.currentWorld,
          worldState: {
            ...state.currentWorld.worldState,
            generation: state.currentWorld.worldState.generation + 1,
          },
        },
      }
    }),

  updatePlayTime: (seconds) =>
    set((state) => {
      if (!state.currentWorld) return state
      return {
        currentWorld: {
          ...state.currentWorld,
          playTimeSeconds: state.currentWorld.playTimeSeconds + seconds,
          lastPlayedAt: Date.now(),
        },
      }
    }),

  getWorldState: () => get().currentWorld?.worldState ?? null,
}))
