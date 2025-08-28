# Podcast Frontend Integration Specification

## Overview
This document outlines the frontend requirements for integrating with the podcast functionality, including real-time updates via Pusher, UI components, and user interactions.

## User Prompt Field
The `userPrompt` field is the primary input for podcast generation. Users provide a prompt describing:
- The topic they want the podcast to cover
- Specific questions they want answered
- The type of content they're looking for
- Any particular angle or perspective they want

Examples of user prompts:
- "Create a podcast about the history of artificial intelligence"
- "Explain quantum computing in simple terms for beginners"
- "Discuss the impact of social media on mental health"
- "Create a podcast episode about sustainable living practices"

The AI will use this prompt to generate complete podcast content, including all segments, scripts, and structure.

## Audio Joining Functionality
The podcast system now generates both individual segment audio files and a complete joined episode audio file:

### Individual Segments
- Each segment is generated as a separate audio file
- Useful for segment-by-segment playback and editing
- Allows users to jump to specific parts of the episode

### Full Episode Audio
- All segments are joined into a single continuous audio file
- Provides a seamless listening experience
- Useful for traditional podcast playback
- Stored as a separate file with its own signed URL

### Audio Joining Process
1. After all individual segments are generated
2. Audio buffers are concatenated in the correct order
3. The joined audio is uploaded to cloud storage
4. A signed URL is generated for the full episode
5. Both individual segments and full episode remain available

## Real-Time Events (Pusher)

### Event Channels
All podcast events are broadcast on the channel: `workspace_{workspaceId}`

### Event Types

#### 1. Podcast Generation Events
```typescript
// Generation Start
{
  event: 'workspace_{workspaceId}_podcast_generation_start',
  data: {
    title: string
  }
}

// Structure Complete
{
  event: 'workspace_{workspaceId}_podcast_structure_complete',
  data: {
    segmentsCount: number
  }
}

// Audio Generation Start
{
  event: 'workspace_{workspaceId}_podcast_audio_generation_start',
  data: {
    totalSegments: number
  }
}

// Segment Progress
{
  event: 'workspace_{workspaceId}_podcast_segment_progress',
  data: {
    currentSegment: number,
    totalSegments: number,
    segmentTitle: string
  }
}

// Audio Generation Complete
{
  event: 'workspace_{workspaceId}_podcast_audio_generation_complete',
  data: {
    totalSegments: number,
    totalDuration: number
  }
}

// Audio Joining Start
{
  event: 'workspace_{workspaceId}_podcast_audio_joining_start',
  data: {
    totalSegments: number
  }
}

// Audio Joining Complete
{
  event: 'workspace_{workspaceId}_podcast_audio_joining_complete',
  data: {
    fullEpisodeObjectKey: string
  }
}

// Audio Joining Error
{
  event: 'workspace_{workspaceId}_podcast_audio_joining_error',
  data: {
    error: string
  }
}

// Summary Complete
{
  event: 'workspace_{workspaceId}_podcast_summary_complete',
  data: {
    summaryGenerated: boolean
  }
}

// Generation Complete
{
  event: 'workspace_{workspaceId}_podcast_ended',
  data: {
    artifactId: string,
    title: string,
    status: 'completed'
  }
}
```

#### 2. Segment Regeneration Events
```typescript
// Regeneration Start
{
  event: 'workspace_{workspaceId}_podcast_segment_regeneration_start',
  data: {
    segmentId: string,
    segmentTitle: string
  }
}

// Regeneration Complete
{
  event: 'workspace_{workspaceId}_podcast_segment_regeneration_complete',
  data: {
    segmentId: string,
    segmentTitle: string,
    duration: number
  }
}

// Full Episode Regeneration Start (after segment update)
{
  event: 'workspace_{workspaceId}_podcast_full_episode_regeneration_start',
  data: {
    reason: 'segment_updated'
  }
}

// Full Episode Regeneration Complete
{
  event: 'workspace_{workspaceId}_podcast_full_episode_regeneration_complete',
  data: {
    fullEpisodeObjectKey: string
  }
}

// Full Episode Regeneration Error
{
  event: 'workspace_{workspaceId}_podcast_full_episode_regeneration_error',
  data: {
    error: string
  }
}
```

#### 3. Episode Deletion Events
```typescript
// Deletion Start
{
  event: 'workspace_{workspaceId}_podcast_deletion_start',
  data: {
    episodeId: string,
    episodeTitle: string
  }
}

// Deletion Complete
{
  event: 'workspace_{workspaceId}_podcast_deletion_complete',
  data: {
    episodeId: string,
    episodeTitle: string
  }
}
```

#### 4. Error Events
```typescript
// General Error
{
  event: 'workspace_{workspaceId}_podcast_error',
  data: {
    error: string,
    analysisType: 'podcast',
    timestamp: string
  }
}

// Segment Error
{
  event: 'workspace_{workspaceId}_podcast_segment_error',
  data: {
    segmentIndex: number,
    error: string
  }
}

// Summary Error
{
  event: 'workspace_{workspaceId}_podcast_summary_error',
  data: {
    error: string
  }
}
```

## UI Components

### 1. Podcast Generation Form
```typescript
interface PodcastGenerationForm {
  title: string;
  description?: string;
  userPrompt: string;
  voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  speed: number; // 0.25 - 4.0
  generateIntro: boolean;
  generateOutro: boolean;
  segmentByTopics: boolean;
}
```

**Required Fields:**
- Title (required)
- User Prompt (required) - The topic, question, or request for the podcast
- Voice (default: 'nova')
- Speed (default: 1.0)

**Optional Fields:**
- Description
- Generate Intro (default: true)
- Generate Outro (default: true)
- Segment by Topics (default: true)

### 2. Podcast List View
```typescript
interface PodcastEpisode {
  id: string;
  title: string;
  description?: string;
  metadata: {
    totalDuration: number;
    voice: string;
    speed: number;
    segments: PodcastSegment[];
    fullEpisodeObjectKey?: string; // Reference to the full joined episode audio
    summary: {
      executiveSummary: string;
      learningObjectives: string[];
      keyConcepts: string[];
      followUpActions: string[];
      targetAudience: string;
      prerequisites: string[];
      tags: string[];
    };
    generatedAt: string;
  };
  segments: {
    id: string;
    title: string;
    audioUrl?: string;
    objectKey?: string;
    startTime: number;
    duration: number;
    order: number;
  }[];
  fullEpisodeUrl?: string; // Signed URL for the full episode
  createdAt: string;
  updatedAt: string;
}
```

### 3. Podcast Player Component
```typescript
interface PodcastPlayer {
  currentSegment: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  segments: PodcastSegment[];
  onSegmentChange: (segmentId: string) => void;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
}
```

### 4. Segment Editor
```typescript
interface SegmentEditor {
  segmentId: string;
  title: string;
  content: string;
  keyPoints: string[];
  order: number;
  onSave: (segment: Partial<PodcastSegment>) => void;
  onRegenerate: (newContent?: string) => void;
}
```

## API Endpoints

### 1. List Episodes
```typescript
// GET /trpc/podcast.listEpisodes
{
  input: {
    workspaceId: string;
  }
}
```

### 2. Get Episode
```typescript
// GET /trpc/podcast.getEpisode
{
  input: {
    episodeId: string;
  }
}
```

### 3. Generate Episode
```typescript
// POST /trpc/podcast.generateEpisode
{
  input: {
    workspaceId: string;
    podcastData: PodcastGenerationForm;
  }
}
```

### 4. Get Episode Schema
```typescript
// GET /trpc/podcast.getEpisodeSchema
{
  input: {
    episodeId: string;
  }
}
```

### 5. Update Episode
```typescript
// POST /trpc/podcast.updateEpisode
{
  input: {
    episodeId: string;
    title?: string;
    description?: string;
  }
}
```

### 6. Delete Episode
```typescript
// POST /trpc/podcast.deleteEpisode
{
  input: {
    episodeId: string;
  }
}
```

### 7. Get Available Voices
```typescript
// GET /trpc/podcast.getAvailableVoices
// No input required
```

### 8. Get Signed URLs
```typescript
// GET /trpc/podcast.getSignedUrls
{
  input: {
    episodeId: string;
  }
}
```

### 9. Get Full Episode URL
```typescript
// GET /trpc/podcast.getFullEpisodeUrl
{
  input: {
    episodeId: string;
  }
}
```

### 10. Regenerate Segment
```typescript
// POST /trpc/podcast.regenerateSegment
{
  input: {
    episodeId: string;
    segmentId: string;
    newContent?: string; // Optional: new content for the segment
    voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
    speed?: number; // 0.25 - 4.0
  }
}
```

## User Experience Flow

### 1. Podcast Generation
1. User fills out podcast generation form with:
   - Title for the podcast
   - User prompt describing the topic, question, or request
   - Optional description
   - Voice and speed preferences
   - Generation options (intro, outro, segmentation)
2. Submit form → show loading state
3. Listen for real-time progress updates:
   - Generation start
   - Structure complete (AI creates episode content from prompt)
   - Audio generation start
   - Segment progress (update progress bar)
   - Audio generation complete
   - Audio joining start (combining segments into full episode)
   - Audio joining complete
   - Summary complete
   - Generation complete
4. Redirect to podcast player or show success message

### 2. Podcast Playback
1. Load episode data
2. Get fresh signed URLs for audio segments
3. Initialize audio player with segments
4. Handle segment navigation
5. Update progress indicators

### 3. Segment Management
1. Display segments in list/grid view
2. Allow editing segment content
3. Provide regenerate option for individual segments
4. Show regeneration progress:
   - Segment regeneration start
   - Segment regeneration complete
   - Full episode regeneration start (to sync all segments)
   - Full episode regeneration complete
5. Update audio URLs after regeneration (both individual segments and full episode)

### 4. Episode Management
1. List all episodes with metadata
2. Allow editing episode title/description
3. Provide delete option with confirmation
4. Show deletion progress

## Error Handling

### 1. Generation Errors
- Display error message with retry option
- Show which step failed
- Provide fallback options

### 2. Audio Loading Errors
- Retry loading audio files
- Show placeholder for failed segments
- Provide manual refresh option

### 3. Network Errors
- Implement retry logic
- Show offline indicators
- Cache episode data when possible

## Loading States

### 1. Generation Progress
```typescript
interface GenerationProgress {
  stage: 'structuring' | 'generating_audio' | 'creating_summary' | 'complete';
  currentSegment?: number;
  totalSegments?: number;
  progress: number; // 0-100
}
```

### 2. Segment Regeneration
```typescript
interface SegmentRegeneration {
  segmentId: string;
  status: 'pending' | 'generating' | 'complete' | 'error';
  progress?: number;
}
```

## Accessibility Requirements

### 1. Audio Controls
- Keyboard navigation for play/pause
- Screen reader support for progress
- Volume controls with labels

### 2. Form Accessibility
- Proper form labels
- Error message associations
- Required field indicators

### 3. Navigation
- Skip links for main content
- Focus management
- ARIA labels for interactive elements

## Performance Considerations

### 1. Audio Loading
- Lazy load audio segments
- Preload next segment
- Implement audio caching

### 2. Real-time Updates
- Debounce frequent updates
- Batch UI updates
- Optimize re-renders

### 3. Data Management
- Implement pagination for episode lists
- Cache episode metadata
- Optimize image/audio loading

## Testing Requirements

### 1. Unit Tests
- Component rendering
- Event handling
- Form validation

### 2. Integration Tests
- API interactions
- Real-time event handling
- Audio playback

### 3. E2E Tests
- Complete podcast generation flow
- Playback functionality
- Error scenarios

## Browser Support

### Required
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

### Audio Support
- Web Audio API
- Media Source Extensions (for streaming)
- AudioContext support

## Security Considerations

### 1. Audio URLs
- Signed URLs expire after 24 hours
- Implement URL refresh logic
- Handle expired URL errors

### 2. User Permissions
- Verify workspace ownership
- Validate episode access
- Sanitize user inputs

### 3. Content Security
- Validate audio file types
- Implement file size limits
- Sanitize episode metadata
