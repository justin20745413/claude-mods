/** Whether Chinese mode is on. */
export type ZhMode = boolean

declare module 'claude-code' {
  interface PluginState {
    'zh-translate': {
      /** Whether Chinese mode is on. */
      isOn: ZhMode
      /** Translations of the newest reply's blocks only, by a hash of the original text. */
      translations: Record<string, string>
      /** The newest reply's final text, so only it is translated. */
      latest: string
    }
  }
}
