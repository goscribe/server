## Meeting Summary Frontend Spec

Note: The `meetingsummary` router is currently commented out. This spec outlines the intended API based on the commented code and typical flows, so the frontend contract is ready when implementation resumes.

### Proposed Endpoints (tRPC)
- **meetingsummary.listSummaries**: `{ workspaceId: string }` → `Artifact[]` (type: `MEETING_SUMMARY`, latest version included)
- **meetingsummary.getSummary**: `{ summaryId: string }` → `Artifact & { versions: Version[] }`
- **meetingsummary.uploadFile**: `{ workspaceId: string; fileName: string; fileBuffer: string /* base64 */; mimeType: string; title?: string }` → `{ id: string; title: string; summary: SummaryData; transcript: string }`
- **meetingsummary.processSchema**: `{ workspaceId: string; meetingData: MeetingSchema }` → `{ id: string; title: string; summary: SummaryData; originalData: MeetingSchema }`
- **meetingsummary.updateSummary**: `{ summaryId: string; title?: string; content?: string }` → `Artifact`
- **meetingsummary.deleteSummary**: `{ summaryId: string }` → `true`
- **meetingsummary.getVersions**: `{ summaryId: string }` → `Version[]`

### Types (simplified)
- **Artifact**: `{ id; workspaceId; type: 'MEETING_SUMMARY'; title; content?; createdAt; updatedAt }`
- **Version**: `{ id; artifactId; version: number; content: string; createdAt }`
- **MeetingSchema**: `{ title: string; participants: string[]; date: string; duration?: string; agenda?: string[]; transcript?: string; notes?: string }`
- **SummaryData**: `{ keyPoints: string[]; actionItems: string[]; decisions: string[]; nextSteps: string[]; insights?: string[]; summary: string }`

### Upload Flow (when implemented)
1. Validate file type (mp3/mp4/wav/m4a).
2. Upload base64 file; backend transcribes (Whisper) then summarizes (GPT), stores artifact + version.
3. Return summary JSON and transcript.

### UX Notes
- Show parsing progress and handle large files.
- Provide manual schema entry as fallback (processSchema).
- Keep version history for edits; show latest version by default.
