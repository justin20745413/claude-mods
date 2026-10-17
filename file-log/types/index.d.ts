export type FileKind = 'created' | 'modified'

/** One file touched in this session. */
export type FileEntry = { path: string; kind: FileKind; count: number; at: number }

/** One file touched today, in any session. */
export type DayEntry = { path: string; kind: FileKind; session: string; cwd: string; at: number }

export type FileLogTab = 'session' | 'today' | 'all' | 'game'

/** What the game tab shows. */
export type GameView = 'menu' | 'snake' | 'dino'

/** A key typed into the game controller, numbered so it is applied once. */
export type GameCmd = { seq: number; key: string }

declare module 'claude-code' {
  interface PluginState {
    'file-log': { files: FileEntry[]; tab: FileLogTab; today: DayEntry[]; gameCmd: GameCmd; pad: string; game: GameView }
  }
}
