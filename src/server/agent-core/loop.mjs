import { updateVolatile } from '@deepseek-ai/cosmokit'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '../canvas-agent/vendor/dsh-agent-loop.mjs'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import ToolResultPruner from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import BasicCompaction from '@deepseek-ai/dsh-compaction-basic'
import * as llmRetry from '@deepseek-ai/dsh-llm-retry'
import * as toolTimeoutPolicy from '@deepseek-ai/dsh-tool-call-timeout-policy'
import CredentialProvider from '@deepseek-ai/dsh-credentials'
import * as PiAi from '../canvas-agent/vendor/dsh-llm-pi-ai.mjs'
import { CANVAS_AGENT_COMPACTION_THRESHOLD_RATIO } from './connection-profile.mjs'

// The dsh loop as PenEcho runs it: the same services in the same order for the Canvas engine and for the PenEcho runner in Lines.
// Keep this list deliberately small. Harness packages may install peer seams for
// composition, but only these plugins are allowed to run inside PenEcho.
export const HARNESS_RUNTIME_PLUGIN_ALLOWLIST = Object.freeze([
  'timer',
  'penecho-credentials',
  'attachment-local',
  'llm',
  'session',
  'session-projection',
  'system-prompt',
  'tools',
  'agent',
  'llm-retry',
  'tool-call-timeout-policy',
  'token-meter',
  'tool-result-pruner',
  'compaction-basic',
  'llm-pi-ai',
  'penecho-cli-llm',
  'project-fs',
  'fs-observation-policy',
  'agent-loop',
])
const HARNESS_RUNTIME_PLUGIN_IDS = new Set(HARNESS_RUNTIME_PLUGIN_ALLOWLIST)

export async function mountRuntimePlugin(ctx, id, plugin, config, allowed = HARNESS_RUNTIME_PLUGIN_IDS) {
  if (!allowed.has(id)) throw new Error(`PenEcho Agent refused non-allowlisted Harness plugin: ${id}`)
  return config === undefined ? ctx.plugin(plugin) : ctx.plugin(plugin, config)
}

// Keys never live in a provider's settings. The loop asks for one by name, and the host answers from where it keeps them.
export class PenEchoCredentials extends CredentialProvider {
  constructor(ctx) {
    super(ctx)
    this.resolveSecret = () => undefined
  }

  async resolve(ref) {
    const value = this.resolveSecret(String(ref))
    return value ? { value, source:'penecho-connection' } : undefined
  }

  async describe(ref) {
    return { configured:Boolean(this.resolveSecret(String(ref))), source:'penecho-connection', writable:false }
  }

  async set() { throw new Error('PenEcho Agent credentials are read-only.') }
  async unset() { throw new Error('PenEcho Agent credentials are read-only.') }
  async readRecord() { return undefined }
  async describeRecord() { return { configured:false, writable:false } }
  async listRecords() { return [] }
  async modifyRecord() { throw new Error('PenEcho Agent credential records are read-only.') }
  async deleteRecord() { throw new Error('PenEcho Agent credential records are read-only.') }
}

// The model runtime, the session, the prompt, the tools, and what keeps a long conversation going: retries, the token meter and compaction.
export async function mountLoopServices(ctx, { persona, mount = mountRuntimePlugin } = {}) {
  await mount(ctx, 'llm', LlmRuntime)
  await mount(ctx, 'session', SessionStore)
  await mount(ctx, 'session-projection', SessionProjection)
  await mount(ctx, 'system-prompt', SystemPrompt, { includeHarnessIdentity:false, includeRuntimeContext:true, personaPrefix:persona })
  await mount(ctx, 'tools', ToolRuntime, { mode:'native' })
  await mount(ctx, 'agent', AgentRegistry)
  await mount(ctx, 'llm-retry', llmRetry)
  await mount(ctx, 'tool-call-timeout-policy', toolTimeoutPolicy)
  await mount(ctx, 'token-meter', TokenMeter)
  await mount(ctx, 'tool-result-pruner', ToolResultPruner)
  await mount(ctx, 'compaction-basic', BasicCompaction, {
    auto:true,
    thresholdRatio:CANVAS_AGENT_COMPACTION_THRESHOLD_RATIO,
    retainRatio:.16,
    maxTokens:4096,
  })
}

// The adapter for API connections. Its provider list stays in memory and is replaced through publishPiProviders.
export async function mountPiAi(ctx, { mount = mountRuntimePlugin } = {}) {
  const piPlugin = await mount(ctx, 'llm-pi-ai', PiAi, { providers:{} })
  await piPlugin.await()
  return piPlugin.config.providers
}

// Pi's configuration is host-owned and stays in memory. Validate before
// publishing; do not mount the upstream settings/profile migration UI.
export function validatePiProviders(providers) {
  return PiAi.Config({ providers }).providers
}

export function publishPiProviders(ctx, target, providers) {
  updateVolatile(target, validatePiProviders(providers))
  ctx.emit('loader/volatile-update')
}

export async function mountAgentLoop(ctx, { mount = mountRuntimePlugin } = {}) {
  await mount(ctx, 'agent-loop', AgentLoop, { agents:[], maxParallelToolCalls:4 })
}
