## Workspace Frontend Spec

### Endpoints (tRPC)
- **workspace.list**: `{ parentId?: string }` → `{ workspaces: Workspace[], folders: Folder[] }`
- **workspace.create**: `{ name: string; description?: string; parentId?: string }` → `Workspace`
- **workspace.createFolder**: `{ name: string; parentId?: string }` → `Folder`
- **workspace.get**: `{ id: string }` → `Workspace & { artifacts: Artifact[]; folder?: Folder; uploads: FileAsset[] }`
- **workspace.share**: `{ id: string }` → `{ shareLink: string } | void`
- **workspace.join**: `{ shareLink: string }` → `{ id; title; description; ownerId; createdAt; updatedAt }`
- **workspace.update**: `{ id: string; name?: string; description?: string }` → `Workspace`
- **workspace.delete**: `{ id: string }` → `true`
- **workspace.getFolderInformation**: `{ id: string }` → `{ folder: Folder; parents: Folder[] }`
- **workspace.uploadFiles**: `{ id: string; files: { filename: string; contentType: string; size: number }[] }` → `{ fileId: string; uploadUrl: string }[]`
- **workspace.deleteFiles**: `{ id: string; fileId: string[] }` → `true`
- **workspace.uploadAndAnalyzeMedia**: `{ workspaceId: string; file: { filename: string; contentType: string; size: number; content: string /* base64 */ }; generateStudyGuide?: boolean; generateFlashcards?: boolean; generateWorksheet?: boolean }` → `{ filename: string; artifacts: { studyGuide: Artifact | null; flashcards: Artifact | null; worksheet: Artifact | null } }`
- **workspace.search**: `{ query: string; limit?: number }` → `Workspace[]`

### Types (simplified)
- **Workspace**: `{ id: string; title: string; description?: string | null; ownerId: string; folderId?: string | null; createdAt: Date; updatedAt: Date; shareLink?: string | null }`
- **Folder**: `{ id: string; name: string; ownerId: string; parentId?: string | null; createdAt: Date; updatedAt: Date }`
- **Artifact**: `{ id: string; workspaceId: string; type: string; title: string; createdById?: string | null; createdAt: Date; updatedAt: Date }`
- **FileAsset**: `{ id: string; userId: string; workspaceId: string; name: string; mimeType: string; size: number; bucket?: string | null; objectKey?: string | null }`

### File Upload Flow
1. Call `workspace.uploadFiles` to get write-signed URLs.
2. PUT file bytes to each `uploadUrl` with correct `Content-Type`.
3. Optionally refresh via `workspace.get` to see uploads.

### Media Analysis Flow
1. Call `workspace.uploadAndAnalyzeMedia` with base64 content and desired generation flags.
2. Subscribe to Pusher `workspace_{workspaceId}` for progress events.
3. On completion, fetch artifacts via `studyguide`, `worksheets`, and flashcards routers.

### Real-Time Events (Pusher)
- **Channel**: `workspace_{workspaceId}`
- **Events** (examples):
  - `{workspaceId}_file_analysis_start`, `{workspaceId}_file_analysis_complete`
  - `{workspaceId}_study_guide_load_start`, `{workspaceId}_study_guide_info`
  - `{workspaceId}_flash_card_load_start`, `{workspaceId}_flash_card_info`
  - `{workspaceId}_worksheet_load_start`, `{workspaceId}_worksheet_info`
  - `{workspaceId}_analysis_cleanup_start`, `{workspaceId}_analysis_cleanup_complete`
  - Overall: `{workspaceId}_analysis_ended`

### UX Notes
- Empty state: show create workspace/folder actions.
- Uploads: show progress per file; deletions from GCS are best-effort.
- Search: debounce input; pass `limit` (default 20).
