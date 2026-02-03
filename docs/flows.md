# Core Flows

## On-Device Capture + Trigger

```mermaid
sequenceDiagram
  participant User
  participant PWA
  participant Recorder
  participant Trigger
  participant Store as IndexedDB

  User->>PWA: Start session
  PWA->>Recorder: getUserMedia + MediaRecorder
  Recorder->>PWA: chunked media buffers
  PWA->>Trigger: frame differencing / audio RMS
  Trigger-->>PWA: trigger fired
  PWA->>PWA: assemble PRE + POST clip
  PWA->>Store: persist clip metadata + blob
```

## Upload + Event Sync

```mermaid
sequenceDiagram
  participant PWA
  participant API as FastAPI
  participant Blob as Blob Storage
  participant DB as Postgres

  PWA->>API: request upload URL + create event
  API->>DB: insert event (status=processing)
  API-->>PWA: SAS upload URL
  PWA->>Blob: upload clip via SAS
  PWA->>API: finalize upload (event id)
  API->>DB: mark uploaded
```

## Processing + Summary Update (Stubbed)

```mermaid
sequenceDiagram
  participant API as FastAPI
  participant Queue as Redis/RQ
  participant Worker
  participant DB as Postgres

  API->>Queue: enqueue clip_uploaded
  Worker->>Queue: dequeue job
  Worker->>Worker: run inference (stub)
  Worker->>API: POST summary
  API->>DB: update event status=done + summary
```

## Frontend Timeline Refresh

```mermaid
sequenceDiagram
  participant PWA
  participant API as FastAPI
  participant DB as Postgres

  loop polling interval
    PWA->>API: GET events for session
    API->>DB: query events
    API-->>PWA: event list + statuses
  end
```

## Local Upload Fallback

If Azurite credentials are not configured, the backend writes uploads to
`backend/.local_uploads` (override via `LOCAL_UPLOAD_DIR`) and still records
events in Postgres.
