# LFGTraining Studio

A real-time AI avatar interaction platform for training funeral home employees to practice conversations with grieving family members.

## Getting Started

First, install the dependencies:

```bash
npm install
```

Then, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Project Structure

- `app/` - Next.js App Router pages and layouts
- `lib/` - Utility functions and configurations
- `app/page.tsx` - Start page
- `app/select-avatar/page.tsx` - Avatar selection page
- `app/session/[id]/page.tsx` - Training session page (CUSTOM mode with OpenAI)

## Technology Stack

The app uses:

- **LiveAvatar SDK**: Real-time avatar video streaming and animation
- **OpenAI Realtime API**: Natural conversation processing with GPT-4o
- **Custom Mode**: OpenAI handles conversation logic while LiveAvatar provides the visual avatar

## Integration

- **API Keys**: LiveAvatar and OpenAI keys configured in `.env.local` (see SETUP.md)
- **Avatar Configuration**: Configured in `lib/avatars.ts`
- **Real-time Video**: Live avatar video streaming via LiveAvatar
- **Conversation AI**: OpenAI Realtime API for natural dialogue
- **Transcripts**: Real-time conversation transcripts

See `SETUP.md` for detailed setup instructions.

## Environment Setup

Create a `.env.local` file in the root directory:

```
NEXT_PUBLIC_LIVEAVATAR_API_KEY=your_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
```

**Note**: The `.env.local` file is gitignored for security. Create it manually with your API keys.

