import type { AiPlugin } from './types'

const plugins = new Map<string, AiPlugin>()

export function registerAiPlugin(plugin: AiPlugin) {
  plugins.set(plugin.id, plugin)
}

export function getAiPlugin(id: string): AiPlugin | undefined {
  return plugins.get(id)
}

export function listAiPlugins(): AiPlugin[] {
  return Array.from(plugins.values())
}
