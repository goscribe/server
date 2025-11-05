# Analysis Progress - Quick Reference

## 🚀 Quick Start

### 1. Subscribe to Progress (Pusher)
```typescript
const channel = pusher.subscribe(`workspace_${workspaceId}`);
channel.bind('analysis_progress', (progress) => {
  console.log(progress.status); // 'uploading', 'analyzing', etc.
});
```

### 2. Query Current Progress (Database)
```typescript
const workspace = await trpc.workspace.get.useQuery({ id: workspaceId });
const progress = workspace.analysisProgress;
```

---

## 📊 Data Structure (TypeScript)

```typescript
interface AnalysisProgress {
  status: 'starting' | 'uploading' | 'analyzing' | 
          'generating_artifacts' | 'generating_study_guide' | 
          'generating_flashcards' | 'completed' | 'error';
  
  filename: string;
  fileType: 'image' | 'pdf';
  startedAt: string;
  completedAt?: string;
  error?: string;
  
  steps: {
    fileUpload: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'error';
    fileAnalysis: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'error';
    studyGuide: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'error';
    flashcards: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'error';
  };
}
```

---

## 🔄 Status Flow

```
starting → uploading → analyzing → generating_artifacts 
  → generating_study_guide → generating_flashcards → completed
```

**Or jump to:** `error` (at any point)

---

## 📝 Example Progress Objects

### Starting
```json
{
  "status": "starting",
  "filename": "biology.pdf",
  "fileType": "pdf",
  "startedAt": "2025-11-05T10:30:00.000Z",
  "steps": {
    "fileUpload": "pending",
    "fileAnalysis": "pending",
    "studyGuide": "pending",
    "flashcards": "pending"
  }
}
```

### In Progress
```json
{
  "status": "generating_flashcards",
  "steps": {
    "fileUpload": "completed",
    "fileAnalysis": "completed",
    "studyGuide": "completed",
    "flashcards": "in_progress"
  }
}
```

### Completed
```json
{
  "status": "completed",
  "startedAt": "2025-11-05T10:30:00.000Z",
  "completedAt": "2025-11-05T10:35:00.000Z",
  "steps": {
    "fileUpload": "completed",
    "fileAnalysis": "completed",
    "studyGuide": "completed",
    "flashcards": "completed"
  }
}
```

### Error
```json
{
  "status": "error",
  "error": "Failed to analyze pdf: Connection timeout",
  "steps": {
    "fileUpload": "completed",
    "fileAnalysis": "error",
    "studyGuide": "skipped",
    "flashcards": "skipped"
  }
}
```

---

## 🎨 UI Helpers

### Status Messages
```typescript
const messages = {
  starting: 'Initializing...',
  uploading: 'Uploading file...',
  analyzing: 'Analyzing content...',
  generating_artifacts: 'Preparing artifacts...',
  generating_study_guide: 'Creating study guide...',
  generating_flashcards: 'Generating flashcards...',
  completed: 'Analysis complete! ✅',
  error: 'An error occurred ❌',
};
```

### Step Icons
```typescript
const icons = {
  pending: '⏳',
  in_progress: '🔄',
  completed: '✅',
  skipped: '⏭️',
  error: '❌',
};
```

### Progress Percentage
```typescript
function getPercentage(progress: AnalysisProgress): number {
  const steps = Object.values(progress.steps);
  const completed = steps.filter(s => s === 'completed').length;
  const total = steps.filter(s => s !== 'skipped').length;
  return Math.round((completed / total) * 100);
}
```

---

## 🔌 Pusher Setup

```typescript
import Pusher from 'pusher-js';

const pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
  cluster: 'us2',
});

const channel = pusher.subscribe(`workspace_${workspaceId}`);

// Single event type for all progress updates
channel.bind('analysis_progress', (progress: AnalysisProgress) => {
  updateUI(progress);
});

// Cleanup
channel.unbind_all();
pusher.unsubscribe(`workspace_${workspaceId}`);
```

---

## ⚡ Common Checks

### Is Analyzing?
```typescript
const isAnalyzing = workspace.fileBeingAnalyzed || 
                   (progress?.status && !['completed', 'error'].includes(progress.status));
```

### Is Complete?
```typescript
const isComplete = progress?.status === 'completed';
```

### Has Error?
```typescript
const hasError = progress?.status === 'error';
const errorMessage = progress?.error;
```

### Duration
```typescript
const duration = new Date(progress.completedAt).getTime() - 
                new Date(progress.startedAt).getTime();
const seconds = Math.floor(duration / 1000);
```

---

## 🎯 Best Practices

1. ✅ Use Pusher for real-time updates
2. ✅ Show progress modal immediately 
3. ✅ Use `fileBeingAnalyzed` as simple boolean check
4. ✅ Handle disconnections with polling fallback
5. ✅ Display friendly error messages
6. ❌ Don't rely solely on polling (use Pusher!)
7. ❌ Don't block UI (allow navigation away)
8. ❌ Don't track worksheets (they're not in progress)

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| No updates | Check Pusher key, cluster, channel name |
| Old data | Query workspace again after upload starts |
| Events missed | Implement polling fallback |
| Wrong channel | Format: `workspace_${workspaceId}` |
| Wrong event | Event name: `'analysis_progress'` |

---

## 📚 Full Documentation

See `ANALYSIS_PROGRESS_SPEC.md` for complete examples and implementation details.



