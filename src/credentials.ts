import { Context } from "@deepseek-ai/cordis"
import { loadLayeredEnv } from "@deepseek-ai/dsh-app-boot"
import { credentialRef, type CredentialProvider } from "@deepseek-ai/dsh-credentials"
import LocalCredentialProvider from "@deepseek-ai/dsh-credentials-local"
import {
  createLaunchEnvironmentSnapshot,
  type LaunchEnvironmentSnapshot,
} from "@deepseek-ai/dsh-launch-environment"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

const CREDENTIAL_REF = credentialRef("DEEPSEEK_API_KEY")
const CREDENTIAL_FILENAME = ".credentials.yaml"

export type CredentialSource = "environment" | "managed" | "project-env" | "user-env" | "missing"

export interface CredentialStatus {
  configured: boolean
  source: CredentialSource
  writable: boolean
}

export interface CredentialStoreOptions {
  env?: NodeJS.ProcessEnv
  home?: string
  platform?: NodeJS.Platform
  cwd?: string
  launchEnvironment?: LaunchEnvironmentSnapshot
}

interface ResolvedCredentialStoreOptions {
  env: NodeJS.ProcessEnv
  home: string
  platform: NodeJS.Platform
  cwd: string
  launchEnvironment?: LaunchEnvironmentSnapshot
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function credentialFilePath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const harnessHome = nonEmpty(env.DSH_HOME) ?? join(home, ".dsh")
  return join(resolve(harnessHome), CREDENTIAL_FILENAME)
}

function optionsWithDefaults(options: CredentialStoreOptions): ResolvedCredentialStoreOptions {
  return {
    env: options.env ?? process.env,
    home: options.home ?? homedir(),
    platform: options.platform ?? process.platform,
    cwd: options.cwd ?? process.cwd(),
    ...(options.launchEnvironment === undefined ? {} : { launchEnvironment: options.launchEnvironment }),
  }
}

function credentialLaunchEnvironment(options: ResolvedCredentialStoreOptions): LaunchEnvironmentSnapshot {
  if (options.launchEnvironment) return options.launchEnvironment
  const isRealLaunch = options.env === process.env && options.home === homedir()
  if (isRealLaunch) return loadLayeredEnv("dsh-tui", options.cwd)
  return createLaunchEnvironmentSnapshot([{
    source: "process",
    values: Object.fromEntries(
      Object.entries(options.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
  }])
}

async function withProvider<T>(
  options: ResolvedCredentialStoreOptions,
  action: (provider: CredentialProvider) => Promise<T>,
): Promise<T> {
  const ctx = new Context()
  ctx.provide("launchEnvironment", credentialLaunchEnvironment(options))
  await ctx.plugin(LocalCredentialProvider, {
    path: credentialFilePath(options.env, options.home),
    watch: false,
  })
  try {
    const provider = ctx.get("credentials")
    if (!provider) throw new Error("Official DSH credential provider did not start")
    return await action(provider)
  } finally {
    await ctx.fiber.dispose()
  }
}

function publicSource(source: string | undefined): CredentialSource {
  if (source === "env") return "environment"
  if (source === "file") return "managed"
  if (source === "project-env") return "project-env"
  if (source === "user-env") return "user-env"
  return "missing"
}

export async function describeDeepSeekCredential(
  rawOptions: CredentialStoreOptions = {},
): Promise<CredentialStatus> {
  return withProvider(optionsWithDefaults(rawOptions), async (provider) => {
    const info = await provider.describe(CREDENTIAL_REF)
    return {
      configured: info.configured,
      source: info.configured ? publicSource(info.source) : "missing",
      writable: info.writable,
    }
  })
}

export async function storeDeepSeekCredential(
  value: string,
  rawOptions: CredentialStoreOptions = {},
): Promise<void> {
  const normalized = nonEmpty(value)
  if (!normalized) throw new Error("DeepSeek API key must not be empty")
  await withProvider(optionsWithDefaults(rawOptions), (provider) => provider.set(CREDENTIAL_REF, normalized))
}

export async function removeDeepSeekCredential(
  rawOptions: CredentialStoreOptions = {},
): Promise<boolean> {
  return withProvider(optionsWithDefaults(rawOptions), async (provider) => {
    const info = await provider.describe(CREDENTIAL_REF)
    if (info.source === "env") {
      await provider.unset(CREDENTIAL_REF)
      return false
    }
    if (info.source !== "file") return false
    await provider.unset(CREDENTIAL_REF)
    return true
  })
}
