## Study Guide Frontend Spec

### Endpoints (tRPC)
- **studyguide.get**: `{ workspaceId: string }` → `{ artifactId: string; title: string; latestVersion: { id: string; content: string; data?: Record<string, unknown> | null; version: number; createdById?: string | null; createdAt: Date } | null }`
- **studyguide.edit**: `{ workspaceId: string; studyGuideId?: string; content: string; data?: Record<string, unknown>; title?: string }` → `{ artifactId: string; version: { id: string; version: number } }`

### Behavior
- `get` will create a default study guide (Editor.js starter block) if none exists.
- `edit` creates a new artifact version and optionally renames the artifact.

### Types (simplified)
- **StudyGuideArtifact**: `{ id: string; workspaceId: string; type: 'STUDY_GUIDE'; title: string }`
- **StudyGuideVersion**: `{ id: string; artifactId: string; content: string; data?: Record<string, unknown> | null; version: number; createdById?: string | null; createdAt: Date }`

### UX Notes
- Store Editor.js document JSON in `content`.
- On save, call `studyguide.edit` (debounce to avoid excessive versions).
- Handle null `latestVersion` gracefully (should be rare due to auto-create).
