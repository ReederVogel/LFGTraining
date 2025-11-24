# LiveAvatar Integration Setup

## Environment Variables

Create a `.env.local` file in the root directory with the following content:

```
NEXT_PUBLIC_LIVEAVATAR_API_KEY=ed58aa4b-3e18-405c-9ccc-db37f170c336
```

## Avatar Configuration

The avatar IDs have been configured in `lib/avatars.ts`:

- **Sarah (Widow)**: `513fd1b7-7ef9-466d-9af2-344e51eeb833`
- **James (Son)**: `55eec60c-d665-4972-a529-bbdcaf665ab8`

## LiveAvatar SDK Integration

The LiveAvatar client is implemented in `lib/liveavatar.ts`. This is a flexible implementation that can be adapted based on the actual LiveAvatar SDK documentation.

### Current Implementation

The implementation includes:

1. **Session Management**: Creates and manages LiveAvatar sessions
2. **Video Streaming**: Handles video element initialization and streaming
3. **Real-time Transcripts**: WebSocket-based transcript handling
4. **Error Handling**: Comprehensive error handling and user feedback

### Next Steps

You may need to update `lib/liveavatar.ts` based on the actual LiveAvatar SDK:

1. **API Base URL**: Update `API_BASE_URL` in `lib/liveavatar.ts` with the correct LiveAvatar API endpoint
2. **SDK Package**: If LiveAvatar provides an npm package, install it and update the imports
3. **Streaming Protocol**: Adapt the video streaming implementation based on LiveAvatar's protocol (HLS, WebRTC, etc.)
4. **WebSocket Format**: Update WebSocket message format based on LiveAvatar's API specification

### Testing

1. Ensure `.env.local` is created with the API key
2. Start the development server: `npm run dev`
3. Navigate to the app and select an avatar
4. The conversation page should initialize the LiveAvatar session
5. Check browser console for any API-related errors

## Troubleshooting

- **API Key Error**: Ensure `NEXT_PUBLIC_LIVEAVATAR_API_KEY` is set in `.env.local`
- **Avatar Not Loading**: Verify avatar IDs are correct in `lib/avatars.ts`
- **Connection Issues**: Check the API base URL in `lib/liveavatar.ts` matches LiveAvatar's documentation

