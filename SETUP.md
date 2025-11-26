# LFGTraining Studio Setup

## Environment Variables

Create a `.env.local` file in the root directory with the following content:

```
NEXT_PUBLIC_LIVEAVATAR_API_KEY=your_liveavatar_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
```

**Important**: Replace the placeholder values with your actual API keys.

## Avatar Configuration

Configure avatars in `lib/avatars.ts`:

- **Sarah (Widow)**: Practicing conversations with a widow who lost her husband
- **Michael (Son)**: Practicing conversations with a son who lost his father

### Avatar Fields

Each avatar requires:
- `avatarId`: LiveAvatar avatar ID (for video streaming)
- `voiceId`: LiveAvatar voice ID (optional, for avatar voice)
- `openaiPromptId`: OpenAI prompt ID (defines the avatar's persona and behavior)
- `openaiPromptVersion`: Version of the OpenAI prompt
- `imageSrc`: Path to avatar placeholder image

## How It Works (CUSTOM Mode)

The app uses **CUSTOM mode** which combines:

1. **LiveAvatar**: Provides real-time video streaming and avatar animation
2. **OpenAI Realtime API**: Handles conversation logic and generates responses
3. **Audio Pipeline**: OpenAI audio is streamed to LiveAvatar for lip-sync

### Flow:

1. User speaks → Microphone captures audio
2. Audio sent to OpenAI Realtime API
3. OpenAI processes speech and generates response
4. Response audio streamed back in real-time
5. Audio sent to LiveAvatar for lip-synced animation
6. User sees avatar speaking with natural lip movements

## Testing

1. Ensure `.env.local` is created with both API keys
2. Start the development server: `npm run dev`
3. Navigate to [http://localhost:3000](http://localhost:3000)
4. Select an avatar
5. Click "Start Session"
6. Begin speaking when connected

## Troubleshooting

- **API Key Error**: Ensure both `NEXT_PUBLIC_LIVEAVATAR_API_KEY` and `OPENAI_API_KEY` are set in `.env.local`
- **Avatar Not Loading**: Verify avatar IDs are correct in `lib/avatars.ts`
- **No Audio**: Check microphone permissions in browser
- **Connection Issues**: Check browser console for detailed error messages
- **OpenAI Errors**: Verify your OpenAI API key has access to the Realtime API

