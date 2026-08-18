import { loadConfig } from "./config.ts"
import { runApp } from "./app.ts"

const config = loadConfig(process.argv.slice(2), process.env)
process.exitCode = await runApp(config)
