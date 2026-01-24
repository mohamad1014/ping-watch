import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { fileURLToPath } from 'url'

const execFileAsync = promisify(execFile)

const resolveWorkerDir = () => {
  const __filename = fileURLToPath(import.meta.url)
  return path.resolve(path.dirname(__filename), '../../../worker')
}

export const postSummaryForEvent = async (
  backendUrl: string,
  eventId: string
) => {
  const workerDir = resolveWorkerDir()
  const pythonPath = path.join(workerDir, '.venv', 'bin', 'python')

  await execFileAsync(
    pythonPath,
    [
      '-c',
      [
        'import os',
        'from app.tasks import process_clip',
        `os.environ["API_BASE_URL"] = "${backendUrl}"`,
        `process_clip({"event_id": "${eventId}"})`,
      ].join('; '),
    ],
    {
      cwd: workerDir,
      env: {
        ...process.env,
        API_BASE_URL: backendUrl,
      },
    }
  )
}
