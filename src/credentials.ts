import { randomUUID } from "node:crypto"
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { parseDocument, stringify } from "yaml"

const CREDENTIAL_REF = "DEEPSEEK_API_KEY"
const CREDENTIAL_FILENAME = ".credentials.yaml"
const GROUP_OR_OTHER_BITS = 0o077

export type CredentialSource = "environment" | "managed" | "missing"

export interface CredentialStatus {
  configured: boolean
  source: CredentialSource
  writable: boolean
}

export interface CredentialStoreOptions {
  env?: NodeJS.ProcessEnv
  home?: string
  platform?: NodeJS.Platform
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

function parseCredentialMapping(text: string, filename: string): Record<string, string> {
  if (!text.trim()) return {}
  const document = parseDocument(text, { uniqueKeys: true })
  if (document.errors.length > 0) throw new Error(`Invalid credential document: ${filename}`)
  const value: unknown = document.toJS()
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid credential document: ${filename}`)
  }
  const entries: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof entry !== "string" || !entry) {
      throw new Error(`Invalid credential document: ${filename}`)
    }
    entries[key] = entry
  }
  return entries
}

function optionsWithDefaults(options: CredentialStoreOptions): Required<CredentialStoreOptions> {
  return {
    env: options.env ?? process.env,
    home: options.home ?? homedir(),
    platform: options.platform ?? process.platform,
  }
}

async function readManagedCredentials(options: Required<CredentialStoreOptions>): Promise<Record<string, string>> {
  const filename = credentialFilePath(options.env, options.home)
  try {
    const metadata = await stat(filename)
    if (options.platform !== "win32" && (metadata.mode & GROUP_OR_OTHER_BITS) !== 0) {
      throw new Error(`Credential file permissions are unsafe: run chmod 600 ${filename}`)
    }
    return parseCredentialMapping(await readFile(filename, "utf8"), filename)
  } catch (error) {
    if (isErrno(error, "ENOENT")) return {}
    throw error
  }
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code
}

function assertWritable(options: Required<CredentialStoreOptions>): void {
  if (nonEmpty(options.env[CREDENTIAL_REF])) {
    throw new Error("The DeepSeek credential is supplied by the environment and is read-only for this launch")
  }
}

async function writeManagedCredentials(
  entries: Record<string, string>,
  options: Required<CredentialStoreOptions>,
): Promise<void> {
  const filename = credentialFilePath(options.env, options.home)
  const directory = dirname(filename)
  const temporary = join(directory, `.${basename(filename)}.${process.pid}.${randomUUID()}.tmp`)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if (options.platform !== "win32") await chmod(directory, 0o700)
  try {
    await writeFile(temporary, stringify(entries), { encoding: "utf8", flag: "wx", mode: 0o600 })
    if (options.platform !== "win32") await chmod(temporary, 0o600)
    await rename(temporary, filename)
    if (options.platform !== "win32") await chmod(filename, 0o600)
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function describeDeepSeekCredential(
  rawOptions: CredentialStoreOptions = {},
): Promise<CredentialStatus> {
  const options = optionsWithDefaults(rawOptions)
  if (nonEmpty(options.env[CREDENTIAL_REF])) {
    return { configured: true, source: "environment", writable: false }
  }
  const entries = await readManagedCredentials(options)
  return nonEmpty(entries[CREDENTIAL_REF])
    ? { configured: true, source: "managed", writable: true }
    : { configured: false, source: "missing", writable: true }
}

export async function storeDeepSeekCredential(
  value: string,
  rawOptions: CredentialStoreOptions = {},
): Promise<void> {
  const options = optionsWithDefaults(rawOptions)
  assertWritable(options)
  const normalized = nonEmpty(value)
  if (!normalized) throw new Error("DeepSeek API key must not be empty")
  const entries = await readManagedCredentials(options)
  entries[CREDENTIAL_REF] = normalized
  await writeManagedCredentials(entries, options)
}

export async function removeDeepSeekCredential(
  rawOptions: CredentialStoreOptions = {},
): Promise<boolean> {
  const options = optionsWithDefaults(rawOptions)
  assertWritable(options)
  const entries = await readManagedCredentials(options)
  if (!(CREDENTIAL_REF in entries)) return false
  delete entries[CREDENTIAL_REF]
  await writeManagedCredentials(entries, options)
  return true
}
