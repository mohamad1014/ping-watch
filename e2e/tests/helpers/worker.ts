import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { fileURLToPath } from 'url'

const execFileAsync = promisify(execFile)

const resolveWorkerDir = () => {
  const __filename = fileURLToPath(import.meta.url)
  return path.resolve(path.dirname(__filename), '../../../worker')
}

type WorkerPayload = {
  event_id: string
  session_id: string
  clip_blob_name: string
  clip_container: string
  analysis_prompt?: string | null
}

export const processUploadedEventWithWorker = async (
  backendUrl: string,
  payload: WorkerPayload
) => {
  const workerDir = resolveWorkerDir()
  const pythonPath = path.join(workerDir, '.venv', 'bin', 'python')
  const payloadJson = JSON.stringify(payload)

  await execFileAsync(
    pythonPath,
    [
      '-c',
      [
        'import os',
        'import json',
        'from app.tasks import process_clip',
        'payload = json.loads(os.environ["PING_WATCH_WORKER_PAYLOAD"])',
        'process_clip(payload)',
      ].join('; '),
    ],
    {
      cwd: workerDir,
      env: {
        ...process.env,
        API_BASE_URL: backendUrl,
        PING_WATCH_TEST_MODE: 'true',
        PING_WATCH_WORKER_PAYLOAD: payloadJson,
      },
    }
  )
}
