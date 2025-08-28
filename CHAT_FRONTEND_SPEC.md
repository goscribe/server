# Chat Frontend Integration Specification

## Overview
This document outlines the frontend requirements for integrating with the chat functionality, including real-time messaging, channel management, and user interactions.

## Real-Time Events (Pusher)

### Event Channels
Chat events are broadcast on different channels:
- Channel events: `workspace_{workspaceId}` 
- Message events: `{channelId}` (the channelId itself is used as the channel name)

### Event Types

#### 1. Channel Management Events
```typescript
// New Channel Created
{
  event: '{workspaceId}_new_channel',
  data: {
    channelId: string,
    workspaceId: string,
    name: string,
    createdAt: string
  }
}

// Channel Edited
{
  event: '{workspaceId}_edit_channel',
  data: {
    channelId: string,
    workspaceId: string,
    name: string
  }
}

// Channel Removed
{
  event: '{workspaceId}_remove_channel',
  data: {
    channelId: string,
    deletedAt: string
  }
}
```

#### 2. Message Events
```typescript
// New Message Posted
{
  event: '{channelId}_new_message',
  data: {
    chatId: string,
    channelId: string,
    userId: string,
    message: string,
    createdAt: string
  }
}

// Message Edited
{
  event: '{channelId}_edit_message',
  data: {
    chatId: string,
    channelId: string,
    userId: string,
    message: string,
    updatedAt: string
  }
}

// Message Deleted
{
  event: '{channelId}_delete_message',
  data: {
    chatId: string,
    channelId: string,
    userId: string,
    deletedAt: string
  }
}
```

## Data Types

### Channel
```typescript
interface Channel {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  chats?: ChatMessage[]; // Includes user information for each message
}
```

### Chat Message
```typescript
interface ChatMessage {
  id: string;
  channelId: string;
  userId: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    name: string;
    image?: string;
  };
}
```

### User Information
All messages include user information with:
- `id`: User ID
- `name`: User display name
- `image`: User avatar (optional)

## API Endpoints

### 1. Get Channels
```typescript
// GET /trpc/chat.getChannels
{
  input: {
    workspaceId: string;
  }
}
// Returns all channels for a workspace with messages and user info
// Creates "General" channel if no channels exist
```

### 2. Get Channel
```typescript
// GET /trpc/chat.getChannel
{
  input: {
    workspaceId?: string;
    channelId?: string;
  }
}
// Returns specific channel with messages and user info
// Creates "General" channel if workspaceId provided and no channelId
```

### 3. Create Channel
```typescript
// POST /trpc/chat.createChannel
{
  input: {
    workspaceId: string;
    name: string;
  }
}
// Creates new channel and returns with messages and user info
```

### 4. Edit Channel
```typescript
// POST /trpc/chat.editChannel
{
  input: {
    workspaceId: string;
    channelId: string;
    name: string;
  }
}
// Updates channel name and returns with messages and user info
```

### 5. Remove Channel
```typescript
// POST /trpc/chat.removeChannel
{
  input: {
    workspaceId: string;
    channelId: string;
  }
}
// Deletes channel and returns { success: true }
```

### 6. Post Message
```typescript
// POST /trpc/chat.postMessage
{
  input: {
    channelId: string;
    message: string;
  }
}
// Creates new message and returns with user info
```

### 7. Edit Message
```typescript
// POST /trpc/chat.editMessage
{
  input: {
    chatId: string;
    message: string;
  }
}
// Updates message and returns with user info
// Only allows editing own messages
```

### 8. Delete Message
```typescript
// POST /trpc/chat.deleteMessage
{
  input: {
    chatId: string;
  }
}
// Deletes message and returns { success: true }
// Only allows deleting own messages
```

## UI Components

### 1. Channel List Component
```typescript
interface ChannelList {
  channels: Channel[];
  currentChannelId?: string;
  onChannelSelect: (channelId: string) => void;
  onCreateChannel: (name: string) => void;
  onEditChannel: (channelId: string, name: string) => void;
  onDeleteChannel: (channelId: string) => void;
}
```

### 2. Chat Interface Component
```typescript
interface ChatInterface {
  channelId: string;
  messages: ChatMessage[];
  currentUserId: string;
  onSendMessage: (message: string) => void;
  onEditMessage: (chatId: string, message: string) => void;
  onDeleteMessage: (chatId: string) => void;
  isLoading: boolean;
}
```

### 3. Message Component
```typescript
interface MessageComponent {
  message: ChatMessage;
  isOwnMessage: boolean;
  onEdit: (chatId: string, newMessage: string) => void;
  onDelete: (chatId: string) => void;
}
```

## User Experience Flow

### 1. Channel Management
1. User opens workspace
2. Load all channels using `getChannels` endpoint
3. System automatically creates "General" channel if no channels exist
4. User can create new channels
5. User can edit channel names
6. User can delete channels (with confirmation)
7. Real-time updates when channels are created/edited/deleted

### 2. Messaging Flow
1. User selects a channel
2. Load existing messages for the channel (includes user info)
3. User types and sends message
4. Message appears immediately (optimistic update)
5. Real-time notification to other users
6. Handle message editing and deletion
7. Show user names and avatars for all messages

### 3. Message Management
1. User can edit their own messages only
2. User can delete their own messages only
3. Real-time updates for message changes
4. Proper error handling for unauthorized actions

## Real-Time Implementation

### PusherService Methods
The chat system uses two different PusherService methods:
- `emitTaskComplete(workspaceId, event, data)` - For channel management events
- `emitChannelEvent(channelId, event, data)` - For message events (channel-specific)

### 1. Initial Channel Loading
```typescript
// Load all channels for a workspace
const channels = await trpc.chat.getChannels.query({ 
  workspaceId: workspaceId 
});

// This will automatically create a "General" channel if none exist
// All channels include messages with user information
```

### 2. Channel Events (Workspace Channel)
```typescript
// Subscribe to workspace channel events
const workspaceChannel = pusher.subscribe(`workspace_${workspaceId}`);

workspaceChannel.bind(`${workspaceId}_new_channel`, (data) => {
  // Add new channel to list
  setChannels(prev => [...prev, data]);
});

workspaceChannel.bind(`${workspaceId}_edit_channel`, (data) => {
  // Update channel name in list
  setChannels(prev => prev.map(ch => 
    ch.id === data.channelId ? { ...ch, name: data.name } : ch
  ));
});

workspaceChannel.bind(`${workspaceId}_remove_channel`, (data) => {
  // Remove channel from list
  setChannels(prev => prev.filter(ch => ch.id !== data.channelId));
});
```

### 3. Message Events (Channel-Specific)
```typescript
// Subscribe to message events for specific channel
const messageChannel = pusher.subscribe(channelId);

messageChannel.bind(`${channelId}_new_message`, (data) => {
  // Add new message to chat
  setMessages(prev => [...prev, data]);
});

messageChannel.bind(`${channelId}_edit_message`, (data) => {
  // Update message in chat
  setMessages(prev => prev.map(msg => 
    msg.id === data.chatId ? { ...msg, message: data.message, updatedAt: data.updatedAt } : msg
  ));
});

messageChannel.bind(`${channelId}_delete_message`, (data) => {
  // Remove message from chat
  setMessages(prev => prev.filter(msg => msg.id !== data.chatId));
});
```

## Error Handling

### 1. Channel Errors
- Channel not found
- Unauthorized to edit/delete channel
- Duplicate channel names

### 2. Message Errors
- Message not found
- Unauthorized to edit/delete message (only own messages)
- Message too long
- Rate limiting

### 3. Network Errors
- Connection lost
- Retry logic for failed operations
- Offline indicators

## Loading States

### 1. Channel Loading
```typescript
interface ChannelLoadingState {
  isLoading: boolean;
  error?: string;
  channels: Channel[];
}
```

### 2. Message Loading
```typescript
interface MessageLoadingState {
  isLoading: boolean;
  isSending: boolean;
  error?: string;
  messages: ChatMessage[];
}
```

## Security & Authorization

### 1. Message Ownership
- Users can only edit their own messages
- Users can only delete their own messages
- Proper validation on server side

### 2. Channel Access
- Users can only access channels in their workspaces
- Proper workspace membership validation

### 3. Input Validation
- Message content validation
- Channel name validation
- Rate limiting for message sending

## Performance Considerations

### 1. Message Loading
- All messages include user info (no additional queries needed)
- Efficient database queries with includes
- Proper indexing on channelId and userId

### 2. Real-time Updates
- Separate channels for workspace and message events
- Efficient event routing
- Optimized payload sizes

### 3. Memory Management
- Clean up Pusher subscriptions when switching channels
- Limit message history in memory
- Garbage collection for old messages

## Testing Requirements

### 1. Unit Tests
- Component rendering with user info
- Message formatting and display
- Channel management logic

### 2. Integration Tests
- API interactions with user data
- Real-time event handling
- Authorization scenarios

### 3. E2E Tests
- Complete messaging flow with user attribution
- Channel management
- Real-time synchronization

## Browser Support

### Required
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

### Real-time Support
- WebSocket support
- Pusher client compatibility
- EventSource fallback

## Future Enhancements

### 1. Advanced Features
- Message reactions
- File attachments
- Voice messages
- Message threading
- Read receipts

### 2. UI Improvements
- Typing indicators
- Message search
- Message pinning
- Channel categories
- Dark mode support

### 3. Performance Optimizations
- Message pagination
- Virtual scrolling
- Offline support
- Background sync
- Push notifications
