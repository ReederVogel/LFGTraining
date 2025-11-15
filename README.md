# LiveAvatar Real-Time Chat App

A Next.js application that enables real-time AI conversations with avatars using LiveAvatar.com.

## Features

- **New Session Flow**: Start a new conversation session with a simple click
- **Avatar Selection**: Choose from two available avatars before starting a conversation
- **Real-Time Conversation**: Engage in live voice conversations with AI avatars
- **Modern UI**: Beautiful, responsive interface built with Tailwind CSS
- **Type-Safe**: Full TypeScript support for better developer experience

## Project Structure

```
realtime-trining-app/
├── app/                           # Next.js App Router
│   ├── layout.tsx                 # Root layout with global styles
│   ├── page.tsx                   # Home page with "New Session" button
│   ├── globals.css                # Global CSS with Tailwind directives
│   ├── select-avatar/
│   │   └── page.tsx               # Avatar selection page
│   └── conversation/
│       └── [avatarId]/
│           └── page.tsx           # Dynamic route for conversation
├── components/                    # Reusable React components
│   ├── ui/
│   │   ├── Button.tsx             # Custom button component
│   │   └── Card.tsx               # Card component for layouts
│   ├── AvatarCard.tsx             # Avatar selection card component
│   └── AvatarEmbed.tsx            # LiveAvatar iframe embed component
├── lib/                           # Utility functions and configurations
│   ├── avatars.ts                 # Avatar configuration data
│   └── constants.ts               # App-wide constants
├── types/                         # TypeScript type definitions
│   └── avatar.ts                  # Avatar-related types
├── public/                        # Static assets
├── .env.local                     # Environment variables (gitignored)
├── .env.example                   # Example environment template
└── README.md                      # Project documentation
```

## Prerequisites

- Node.js 18.17 or later
- npm or yarn package manager
- LiveAvatar.com API key

## Setup Instructions

1. **Clone the repository** (if applicable) or navigate to the project directory:
   ```bash
   cd realtime-trining-app
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   - Copy `.env.example` to `.env.local`:
     ```bash
     cp .env.example .env.local
     ```
   - Open `.env.local` and add your LiveAvatar API key:
     ```
     NEXT_PUBLIC_LIVEAVATAR_API_KEY=your_api_key_here
     ```

4. **Run the development server**:
   ```bash
   npm run dev
   ```

5. **Open your browser**:
   Navigate to [http://localhost:3000](http://localhost:3000)

## Usage

1. **Start a New Session**: Click the "New Session" button on the home page
2. **Select an Avatar**: Choose from the available avatars on the selection page
3. **Start Conversation**: Once an avatar is selected, you'll be taken to the conversation page
4. **Allow Microphone Access**: Grant microphone permissions when prompted to enable voice conversation
5. **Chat**: Begin your real-time conversation with the AI avatar

## Technology Stack

- **Framework**: Next.js 13+ (App Router)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS
- **Avatar SDK**: @heygen/liveavatar-web-sdk
- **Avatar Integration**: Iframe embeds with microphone access

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_LIVEAVATAR_API_KEY` | Your LiveAvatar.com API key | Yes |

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

## Avatar Configuration

Avatars are configured in `lib/avatars.ts`. Each avatar includes:
- Unique ID
- Display name
- Embed ID (for iframe embedding)
- Context ID (for conversation context)

To add more avatars, update the `avatars` array in `lib/avatars.ts`.

## Development

The project uses:
- **TypeScript** for type safety
- **Tailwind CSS** for styling
- **Next.js App Router** for routing
- **React Server Components** where applicable
- **Client Components** for interactive features

## Deployment

This application can be deployed to any platform that supports Next.js, such as:
- [Vercel](https://vercel.com) (recommended)
- [Netlify](https://netlify.com)
- [AWS Amplify](https://aws.amazon.com/amplify/)
- Any Node.js hosting platform

Make sure to set your environment variables in your deployment platform's settings.

## License

This project is open source and available under the MIT License.

## Support

For issues related to:
- **LiveAvatar SDK**: Visit [LiveAvatar Documentation](https://www.npmjs.com/package/@heygen/liveavatar-web-sdk)
- **Next.js**: Visit [Next.js Documentation](https://nextjs.org/docs)
