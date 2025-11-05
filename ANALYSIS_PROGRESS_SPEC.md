# Analysis Progress Integration Spec

## Overview
The analysis progress system tracks file upload and analysis status in real-time using both database storage and Pusher events.

---

## 1. Data Structure

### `Workspace.analysisProgress` (JSON field)

```typescript
interface AnalysisProgress {
  status: AnalysisStatus;
  filename: string;
  fileType: 'image' | 'pdf';
  startedAt: string; // ISO 8601 timestamp
  completedAt?: string; // ISO 8601 timestamp (only when completed)
  error?: string; // Error message (only when status is 'error')
  steps: {
    fileUpload: StepStatus;
    fileAnalysis: StepStatus;
    studyGuide: StepStatus;
    flashcards: StepStatus;
  };
}

type AnalysisStatus = 
  | 'starting'
  | 'uploading'
  | 'analyzing'
  | 'generating_artifacts'
  | 'generating_study_guide'
  | 'generating_flashcards'
  | 'completed'
  | 'error';

type StepStatus = 
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'skipped'
  | 'error';
```

---

## 2. Status Flow

### Normal Flow (All artifacts enabled)
```
starting
  → uploading
    → analyzing
      → generating_artifacts
        → generating_study_guide
          → generating_flashcards
            → completed
```

### Error Flow
```
Any status → error (with error message)
```

### Skipped Artifacts
If user doesn't select certain artifacts, their steps will be marked as `'skipped'`:

```typescript
// Example: Only flashcards enabled
{
  status: 'generating_flashcards',
  steps: {
    fileUpload: 'completed',
    fileAnalysis: 'completed',
    studyGuide: 'skipped',  // ← Not requested
    flashcards: 'in_progress'
  }
}
```

---

## 3. Real-time Updates (Pusher)

### Subscribe to Progress Events

```typescript
import Pusher from 'pusher-js';

const pusher = new Pusher('YOUR_PUSHER_KEY', {
  cluster: 'us2',
});

const channel = pusher.subscribe(`workspace_${workspaceId}`);

channel.bind('analysis_progress', (progress: AnalysisProgress) => {
  console.log('Progress update:', progress);
  
  // Update your UI based on progress
  updateProgressUI(progress);
});
```

### Event Timing
- Event is emitted **every time** the progress changes
- Happens **before** the database write completes
- Frontend receives updates in real-time as analysis progresses

---

## 4. Database Queries (tRPC)

### Get Workspace with Progress

```typescript
// Query the workspace to get current progress
const workspace = await trpc.workspace.get.useQuery({ 
  id: workspaceId 
});

// Access progress
const progress = workspace.analysisProgress;

if (progress?.status === 'generating_flashcards') {
  // Show flashcards generation UI
}
```

### Polling Alternative (if Pusher disconnects)

```typescript
const { data: workspace, refetch } = trpc.workspace.get.useQuery(
  { id: workspaceId },
  { 
    refetchInterval: (data) => {
      // Poll every 2 seconds while analyzing
      return data?.fileBeingAnalyzed ? 2000 : false;
    }
  }
);
```

---

## 5. UI Implementation Examples

### React Component Example

```tsx
import { useState, useEffect } from 'react';
import Pusher from 'pusher-js';
import { trpc } from '@/lib/trpc';

interface Props {
  workspaceId: string;
}

export function AnalysisProgressIndicator({ workspaceId }: Props) {
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const { data: workspace } = trpc.workspace.get.useQuery({ id: workspaceId });

  useEffect(() => {
    // Initialize with DB state
    if (workspace?.analysisProgress) {
      setProgress(workspace.analysisProgress);
    }

    // Subscribe to real-time updates
    const pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster: 'us2',
    });

    const channel = pusher.subscribe(`workspace_${workspaceId}`);
    
    channel.bind('analysis_progress', (newProgress: AnalysisProgress) => {
      setProgress(newProgress);
    });

    return () => {
      channel.unbind_all();
      pusher.unsubscribe(`workspace_${workspaceId}`);
    };
  }, [workspaceId, workspace]);

  if (!progress) return null;

  return (
    <div className="progress-indicator">
      <h3>{getStatusMessage(progress.status)}</h3>
      <p>Analyzing: {progress.filename}</p>
      
      <div className="steps">
        <Step name="Upload" status={progress.steps.fileUpload} />
        <Step name="Analysis" status={progress.steps.fileAnalysis} />
        <Step name="Study Guide" status={progress.steps.studyGuide} />
        <Step name="Flashcards" status={progress.steps.flashcards} />
      </div>

      {progress.error && (
        <div className="error">{progress.error}</div>
      )}

      {progress.completedAt && (
        <div className="success">
          Completed in {calculateDuration(progress.startedAt, progress.completedAt)}
        </div>
      )}
    </div>
  );
}

function getStatusMessage(status: AnalysisStatus): string {
  const messages: Record<AnalysisStatus, string> = {
    starting: 'Initializing...',
    uploading: 'Uploading file...',
    analyzing: 'Analyzing content...',
    generating_artifacts: 'Preparing artifacts...',
    generating_study_guide: 'Creating study guide...',
    generating_flashcards: 'Generating flashcards...',
    completed: 'Analysis complete!',
    error: 'An error occurred',
  };
  return messages[status];
}

function Step({ name, status }: { name: string; status: StepStatus }) {
  const icon = {
    pending: '⏳',
    in_progress: '🔄',
    completed: '✅',
    skipped: '⏭️',
    error: '❌',
  }[status];

  return (
    <div className={`step step-${status}`}>
      <span>{icon}</span>
      <span>{name}</span>
    </div>
  );
}

function calculateDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const seconds = Math.floor(ms / 1000);
  return `${seconds}s`;
}
```

---

## 6. Progress Percentage Calculation

```typescript
function calculateProgress(progress: AnalysisProgress): number {
  const steps = Object.values(progress.steps);
  const completed = steps.filter(s => s === 'completed').length;
  const total = steps.filter(s => s !== 'skipped').length;
  
  return total > 0 ? Math.round((completed / total) * 100) : 0;
}

// Usage
const percentage = calculateProgress(progress);
// Returns: 0-100
```

---

## 7. Backend Endpoint (Reference)

### Trigger Analysis

```typescript
// Call this to start analysis
const result = await trpc.workspace.uploadAndAnalyzeMedia.mutate({
  workspaceId: 'workspace_123',
  file: {
    filename: 'biology-notes.pdf',
    contentType: 'application/pdf',
    size: 1024000,
    content: base64EncodedContent,
  },
  generateStudyGuide: true,
  generateFlashcards: true,
  generateWorksheet: false,  // This won't appear in progress
});
```

---

## 8. Common Patterns

### Show Modal During Analysis

```tsx
function AnalysisModal({ workspaceId }: { workspaceId: string }) {
  const { data: workspace } = trpc.workspace.get.useQuery({ id: workspaceId });
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);

  // Subscribe to progress...

  const isAnalyzing = workspace?.fileBeingAnalyzed || 
                     (progress && progress.status !== 'completed' && progress.status !== 'error');

  if (!isAnalyzing) return null;

  return (
    <Modal>
      <AnalysisProgressIndicator workspaceId={workspaceId} />
    </Modal>
  );
}
```

### Redirect on Completion

```tsx
useEffect(() => {
  if (progress?.status === 'completed') {
    setTimeout(() => {
      router.push(`/workspace/${workspaceId}`);
    }, 2000); // Show success message for 2s
  }
}, [progress?.status]);
```

### Handle Errors

```tsx
useEffect(() => {
  if (progress?.status === 'error') {
    toast.error(`Analysis failed: ${progress.error}`);
    
    // Allow user to retry
    setShowRetryButton(true);
  }
}, [progress?.status]);
```

---

## 9. Testing

### Mock Progress States

```typescript
const mockProgress: AnalysisProgress = {
  status: 'generating_flashcards',
  filename: 'test.pdf',
  fileType: 'pdf',
  startedAt: new Date().toISOString(),
  steps: {
    fileUpload: 'completed',
    fileAnalysis: 'completed',
    studyGuide: 'completed',
    flashcards: 'in_progress',
  },
};
```

### Simulate Progress

```typescript
const statuses: AnalysisStatus[] = [
  'starting',
  'uploading',
  'analyzing',
  'generating_artifacts',
  'generating_study_guide',
  'generating_flashcards',
  'completed',
];

let index = 0;
const interval = setInterval(() => {
  setProgress(prev => ({
    ...prev!,
    status: statuses[index],
  }));
  
  if (++index >= statuses.length) {
    clearInterval(interval);
  }
}, 2000);
```

---

## 10. Important Notes

### ⚠️ Critical Behaviors

1. **Pusher is Primary**: Database is backup. Always prioritize Pusher events.
2. **No Worksheet Tracking**: Worksheets are generated but NOT tracked in progress.
3. **Boolean Flag**: `workspace.fileBeingAnalyzed` is simpler check for "is analyzing".
4. **Progress Persistence**: Progress persists in DB even after completion (for history).
5. **Timestamps**: All timestamps are ISO 8601 strings (use `new Date(timestamp)`).

### 🎯 Best Practices

1. Show progress modal immediately on file upload
2. Use optimistic UI updates with Pusher
3. Fall back to polling if Pusher connection fails
4. Clear progress UI gracefully on completion (2-3s delay)
5. Allow users to navigate away (background processing)

---

## 11. Complete Example Flow

```typescript
// 1. User uploads file
const uploadResult = await trpc.workspace.uploadAndAnalyzeMedia.mutate({
  workspaceId,
  file: uploadedFile,
  generateStudyGuide: true,
  generateFlashcards: true,
  generateWorksheet: false,
});

// 2. Frontend receives Pusher events automatically:
// Event 1: { status: 'starting', steps: { fileUpload: 'pending', ... } }
// Event 2: { status: 'uploading', steps: { fileUpload: 'in_progress', ... } }
// Event 3: { status: 'analyzing', steps: { fileUpload: 'completed', fileAnalysis: 'in_progress', ... } }
// ...
// Event N: { status: 'completed', steps: { all: 'completed', ... }, completedAt: '...' }

// 3. UI updates automatically via state
// 4. On completion, redirect to workspace
```

---

## 12. Troubleshooting

### Issue: Progress not updating
- **Check**: Pusher connection status
- **Check**: Correct channel name `workspace_${workspaceId}`
- **Check**: Event name is `'analysis_progress'`
- **Fallback**: Use polling with `refetchInterval`

### Issue: Progress shows old data
- **Solution**: Clear `analysisProgress` on new upload
- **Solution**: Check `fileBeingAnalyzed` flag first

### Issue: Pusher disconnects
- **Solution**: Implement reconnection logic
- **Solution**: Fall back to polling
- **Solution**: Check Pusher key and cluster config

---

## Support

For backend changes or questions, check:
- `/src/routers/workspace.ts` - Main logic
- `/src/lib/pusher.ts` - Pusher service
- `/prisma/schema.prisma` - Database schema



