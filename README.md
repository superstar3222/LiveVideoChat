# LiveChat

<img width="1312" alt="Screenshot 2024-10-25 at 2 13 24 AM" src="https://github.com/user-attachments/assets/308da890-a7b7-4b5f-8bb8-b295d26a6ec5">

Live video avatar chat application. Connects to an Eliza instance running the "Direct" client. Requires a Simli AI Open AI, and ElevenLabs API key.

## Requirements

### Eliza

[Eliza](https://github.com/ai16z/eliza) has to be running and you must paste the agentId into [main.tsx](/src/main.tsx)'s `AGENT_ID` variable.

### Environment Variables

`.env.example` should be copied into a file called `.env`. All of three of the api keys need to be populated.

- `VITE_OPENAI_API_KEY`
- `VITE_SIMLI_API_KEY`
- `VITE_ELEVENLABS_API_KEY`

## Options

You can update [main.tsx](/src/main.tsx)'s `SIMLI_FACE_ID` and `ELEVENLABS_VOICE_ID` to control the avatar and voice used respectively.

The port the application runs on can be updated in the [vite.config](/vite.config.ts).
