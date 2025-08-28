# Chat Frontend Integration Specification

## Overview
This document outlines the frontend requirements for integrating with the chat functionality, including real-time messaging, channel management, and user interactions.

## Real-Time Events (Pusher)

### Event Channels
Chat events are broadcast on the channel: `{channelId}` for channel-specific events

### Event Types

#### 1. Channel Management Events
```typescript
// New Channel Created
{
  event: '{channelId}_new_channel',
  data: {
    channelId: string,
    workspaceId: string,
    name: string,
    createdAt: string
  }
}

// Channel Edited
{
  event: '{channelId}_edit_channel',
  data: {
    channelId: string,
    workspaceId: string,
    name: string
  }
}

// Channel Removed
{
  event: '{channelId}_remove_channel',
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
  onReply?: (chatId: string) => void;
}
```

### 4. Channel Creation Modal
```typescript
interface ChannelCreationModal {
  workspaceId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (channel: Channel) => void;
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
  chats?: ChatMessage[];
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
}
```

## API Endpoints

### 1. Get Channel
```typescript
// GET /trpc/chat.getChannel
{
  input: {
    workspaceId?: string;
    channelId?: string;
  }
}
// Returns channel with messages or creates default "General" channel
```

### 2. Create Channel
```typescript
// POST /trpc/chat.createChannel
{
  input: {
    workspaceId: string;
    name: string;
  }
}
```

### 3. Edit Channel
```typescript
// POST /trpc/chat.editChannel
{
  input: {
    workspaceId: string;
    channelId: string;
    name: string;
  }
}
```

### 4. Remove Channel
```typescript
// POST /trpc/chat.removeChannel
{
  input: {
    workspaceId: string;
    channelId: string;
  }
}
```

### 5. Post Message
```typescript
// POST /trpc/chat.postMessage
{
  input: {
    channelId: string;
    message: string;
  }
}
```

### 6. Edit Message
```typescript
// POST /trpc/chat.editMessage
{
  input: {
    chatId: string;
    message: string;
  }
}
```

### 7. Delete Message
```typescript
// POST /trpc/chat.deleteMessage
{
  input: {
    chatId: string;
  }
}
```

## User Experience Flow

### 1. Channel Management
1. User opens workspace
2. System automatically creates "General" channel if no channels exist
3. User can create new channels
4. User can edit channel names
5. User can delete channels (with confirmation)
6. Real-time updates when channels are created/edited/deleted

### 2. Messaging Flow
1. User selects a channel
2. Load existing messages for the channel
3. User types and sends message
4. Message appears immediately (optimistic update)
5. Real-time notification to other users
6. Handle message editing and deletion
7. Show typing indicators (future enhancement)

### 3. Message Management
1. User can edit their own messages
2. User can delete their own messages
3. Real-time updates for message changes
4. Proper error handling for unauthorized actions

## Real-Time Implementation

### 1. Channel Events
```typescript
// Subscribe to channel events
const channel = pusher.subscribe(`channel_${channelId}`);

channel.bind('new_channel', (data) => {
  // Add new channel to list
  setChannels(prev => [...prev, data]);
});

channel.bind('edit_channel', (data) => {
  // Update channel name in list
  setChannels(prev => prev.map(ch => 
    ch.id === data.channelId ? { ...ch, name: data.name } : ch
  ));
});

channel.bind('remove_channel', (data) => {
  // Remove channel from list
  setChannels(prev => prev.filter(ch => ch.id !== data.channelId));
});
```

### 2. Message Events
```typescript
// Subscribe to message events
const channel = pusher.subscribe(`channel_${channelId}`);

channel.bind('new_message', (data) => {
  // Add new message to chat
  setMessages(prev => [...prev, data]);
});

channel.bind('edit_message', (data) => {
  // Update message in chat
  setMessages(prev => prev.map(msg => 
    msg.id === data.chatId ? { ...msg, message: data.message, updatedAt: data.updatedAt } : msg
  ));
});

channel.bind('delete_message', (data) => {
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
- Unauthorized to edit/delete message
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

## Accessibility Requirements

### 1. Keyboard Navigation
- Tab through channels and messages
- Enter to send messages
- Escape to close modals
- Arrow keys for message navigation

### 2. Screen Reader Support
- Announce new messages
- Announce channel changes
- Proper ARIA labels for interactive elements

### 3. Focus Management
- Focus moves to new messages
- Focus returns to input after sending
- Focus management for modals

## Performance Considerations

### 1. Message Loading
- Pagination for large message histories
- Virtual scrolling for long message lists
- Lazy loading of message content

### 2. Real-time Updates
- Debounce frequent updates
- Batch UI updates
- Optimize re-renders

### 3. Memory Management
- Clean up Pusher subscriptions
- Limit message history in memory
- Garbage collection for old messages

## Security Considerations

### 1. Message Validation
- Sanitize user input
- Prevent XSS attacks
- Rate limiting for message sending

### 2. Authorization
- Verify user permissions for channel operations
- Validate message ownership for edits/deletes
- Check workspace membership

### 3. Data Privacy
- Encrypt sensitive messages (future enhancement)
- Secure real-time connections
- Proper session management

## Testing Requirements

### 1. Unit Tests
- Component rendering
- Message formatting
- Channel management logic

### 2. Integration Tests
- API interactions
- Real-time event handling
- Error scenarios

### 3. E2E Tests
- Complete messaging flow
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
- Message caching
- Offline support
- Background sync
- Push notifications
