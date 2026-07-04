export interface WorldSave {
  id: string
  name: string
  createdAt: number
  lastPlayedAt: number
  playTimeSeconds: number
  seed: number
  worldState: WorldState
}

export interface WorldState {
  entities: EntityData[]
  mechanics: MechanicData[]
  eventLog: EventEntry[]
  terrain: TerrainModification[]
  playerAbilities: string[]
  aiMemory: string
  generation: number
}

export interface EntityData {
  id: string
  name: string
  type: string
  position: [number, number, number]
  behavior: string
  color: string
  size: number
  health: number
  faction?: string
  generation?: number
}

export interface MechanicData {
  id: string
  name: string
  description: string
  trigger: string
  effect: string
  active: boolean
}

export interface EventEntry {
  timestamp: number
  message: string
  type: 'ai_create' | 'ai_update' | 'player' | 'world'
}

export interface TerrainModification {
  type: 'mountain' | 'cave' | 'river' | 'anomaly'
  position: [number, number]
  radius: number
  strength: number
}

const DB_NAME = 'genesis'
const DB_VERSION = 1
const STORE_NAME = 'worlds'
const MAX_WORLDS = 20

class SaveManager {
  private db: IDBDatabase | null = null

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex('lastPlayedAt', 'lastPlayedAt', { unique: false })
        }
      }
      request.onsuccess = (e) => {
        this.db = (e.target as IDBOpenDBRequest).result
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
  }

  async listWorlds(): Promise<WorldSave[]> {
    if (!this.db) await this.init()
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.getAll()
      request.onsuccess = () => {
        const worlds = (request.result as WorldSave[]).sort(
          (a, b) => b.lastPlayedAt - a.lastPlayedAt
        )
        resolve(worlds)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async saveWorld(world: WorldSave): Promise<void> {
    if (!this.db) await this.init()
    const worlds = await this.listWorlds()
    if (worlds.length >= MAX_WORLDS && !worlds.find(w => w.id === world.id)) {
      throw new Error(`Максимум ${MAX_WORLDS} миров`)
    }
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.put(world)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async loadWorld(id: string): Promise<WorldSave | null> {
    if (!this.db) await this.init()
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.get(id)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  async deleteWorld(id: string): Promise<void> {
    if (!this.db) await this.init()
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.delete(id)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  // Удалить все миры — полностью сносим базу данных
  async deleteAllWorlds(): Promise<void> {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close()
        this.db = null
      }
      const request = indexedDB.deleteDatabase(DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()   // resolve в любом случае
      request.onblocked = () => resolve() // resolve если заблокировано
    })
  }

  createNewWorld(name: string): WorldSave {
    return {
      id: crypto.randomUUID(),
      name,
      createdAt: Date.now(),
      lastPlayedAt: Date.now(),
      playTimeSeconds: 0,
      seed: Math.floor(Math.random() * 999999),
      worldState: {
        entities: [],
        mechanics: [],
        eventLog: [],
        terrain: [],
        playerAbilities: [],
        aiMemory: '',
        generation: 0,
      },
    }
  }
}

export const saveManager = new SaveManager()
