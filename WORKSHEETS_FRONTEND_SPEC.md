## Worksheets Frontend Spec

### Endpoints (tRPC)
- **worksheets.list**: `{ workspaceId: string }` → `Worksheet[]` (latest version included, questions merged with user progress)
- **worksheets.create**: `{ workspaceId: string; title: string; description?: string; difficulty?: 'EASY'|'MEDIUM'|'HARD'; estimatedTime?: string; problems?: { question: string; answer: string; type?: QuestionType; options?: string[] }[] }` → `Worksheet & { questions: Question[] }`
- **worksheets.get**: `{ worksheetId: string }` → `Worksheet & { questions: Question[] }` (questions merged with progress)
- **worksheets.createWorksheetQuestion**: `{ worksheetId: string; prompt: string; answer?: string; type?: QuestionType; difficulty?: Difficulty; order?: number; meta?: Record<string, unknown> }` → `Question`
- **worksheets.updateWorksheetQuestion**: `{ worksheetQuestionId: string; prompt?: string; answer?: string; type?: QuestionType; difficulty?: Difficulty; order?: number; meta?: Record<string, unknown> }` → `Question`
- **worksheets.deleteWorksheetQuestion**: `{ worksheetQuestionId: string }` → `true`
- **worksheets.updateProblemStatus**: `{ problemId: string; completed: boolean; answer?: string }` → `WorksheetQuestionProgress`
- **worksheets.getProgress**: `{ worksheetId: string }` → `WorksheetQuestionProgress[]`
- **worksheets.update**: `{ id: string; title?: string; description?: string; difficulty?: Difficulty; estimatedTime?: string; problems?: { id?: string; question: string; answer: string; type?: QuestionType; options?: string[] }[] }` → `Worksheet & { questions: Question[] }`
- **worksheets.delete**: `{ id: string }` → `true`

### Types (simplified)
- **Worksheet**: `{ id: string; workspaceId: string; type: 'WORKSHEET'; title: string; description?: string | null; difficulty?: 'EASY'|'MEDIUM'|'HARD' | null; estimatedTime?: string | null; createdAt: Date; updatedAt: Date }`
- **Question**: `{ id: string; artifactId: string; prompt: string; answer?: string | null; type: QuestionType; difficulty: Difficulty; order: number; meta?: { options?: string[]; completed?: boolean; userAnswer?: string | null; completedAt?: string | Date | null } }`
- **QuestionType**: `'MULTIPLE_CHOICE'|'TEXT'|'NUMERIC'|'TRUE_FALSE'|'MATCHING'|'FILL_IN_THE_BLANK'`
- **Difficulty**: `'EASY'|'MEDIUM'|'HARD'`
- **WorksheetQuestionProgress**: `{ id: string; worksheetQuestionId: string; userId: string; completed: boolean; userAnswer?: string | null; completedAt?: Date | null; attempts: number }`

### UX Notes
- When listing or fetching a worksheet, question `meta` already contains per-user progress fields.
- For multiple-choice, render `meta.options` if present.
- Use optimistic UI for creating/updating/deleting questions.
- Respect ordering via `order`.
