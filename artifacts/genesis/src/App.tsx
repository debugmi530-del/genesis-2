import { useState } from 'react'
import MainMenu from './pages/MainMenu'
import GameView from './pages/GameView'
import type { WorldSave } from './store/saveManager'

type Screen = 'menu' | 'game'

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu')
  const [activeWorld, setActiveWorld] = useState<WorldSave | null>(null)

  function handleEnterWorld(world: WorldSave) {
    setActiveWorld(world)
    setScreen('game')
  }

  function handleExitToMenu() {
    setActiveWorld(null)
    setScreen('menu')
  }

  return (
    <div className="w-screen h-screen overflow-hidden bg-black">
      {screen === 'menu' && (
        <MainMenu onEnterWorld={handleEnterWorld} />
      )}
      {screen === 'game' && activeWorld && (
        <GameView onExit={handleExitToMenu} />
      )}
    </div>
  )
}
