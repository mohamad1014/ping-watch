import { spawn } from 'child_process'
import { once } from 'events'
import { access, rm } from 'fs/promises'
import net from 'net'
import { tmpdir } from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const getFreePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'object' && address) {
        const port = address.port
        server.close(() => resolve(port))
      } else {
        reject(new Error('Failed to get a free port'))
      }
    })
  })

const waitForUrl = async (url: string, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {
      // retry
    }
    await wait(100)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

const resolveRepoRoot = () => {
  const __filename = fileURLToPath(import.meta.url)
  return path.resolve(path.dirname(__filename), '../../..')
}

export const startServers = async () => {
  const repoRoot = resolveRepoRoot()
  const frontendDir = path.join(repoRoot, 'frontend')
  const backendDir = path.join(repoRoot, 'backend')

  const backendPort = await getFreePort()
  const frontendPort = await getFreePort()

  const backendUrl = `http://127.0.0.1:${backendPort}`
  const frontendUrl = `http://127.0.0.1:${frontendPort}`

  const uvicornPath = path.join(backendDir, '.venv', 'bin', 'uvicorn')
  await access(uvicornPath)
  const dbPath = path.join(
    tmpdir(),
    `ping-watch-live-flow-${process.pid}-${Date.now()}.db`
  )
  const dbUrl = `sqlite:///${dbPath.replace(/\\/g, '/')}`
  const localUploadDir = path.join(
    tmpdir(),
    `ping-watch-live-flow-uploads-${process.pid}-${Date.now()}`
  )
  await rm(dbPath, { force: true })
  await rm(localUploadDir, { recursive: true, force: true })

  const backendProcess = spawn(
    uvicornPath,
    ['app.main:app', '--host', '127.0.0.1', '--port', `${backendPort}`],
    {
      cwd: backendDir,
      env: {
        ...process.env,
        PYTHONPATH: backendDir,
        DATABASE_URL: dbUrl,
        LOCAL_UPLOAD_DIR: localUploadDir,
      },
      stdio: 'inherit',
    }
  )

  const frontendProcess = spawn(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'dev', '--', '--host', '127.0.0.1', '--port', `${frontendPort}`],
    {
      cwd: frontendDir,
      env: {
        ...process.env,
        VITE_API_URL: backendUrl,
        VITE_POLL_INTERVAL_MS: '1000',
        VITE_DISABLE_MEDIA: 'true',
      },
      stdio: 'inherit',
    }
  )

  const stop = async () => {
    backendProcess.kill('SIGTERM')
    frontendProcess.kill('SIGTERM')
    await Promise.all([
      once(backendProcess, 'exit').catch(() => undefined),
      once(frontendProcess, 'exit').catch(() => undefined),
    ])
    await rm(dbPath, { force: true })
    await rm(localUploadDir, { recursive: true, force: true })
  }

  try {
    await waitForUrl(`${backendUrl}/health`)
    await waitForUrl(frontendUrl)
  } catch (error) {
    await stop()
    throw error
  }

  return {
    backendUrl,
    frontendUrl,
    stop,
  }
}
