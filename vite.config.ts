import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default ({ mode }) => {
  // Load environment variables and expose them as Vite environment variables
  const env = loadEnv(mode, process.cwd())

  return defineConfig({
    plugins: [react()],
    define: {
      // Explicitly define the variables you want to inject into the build
      'process.env': process.env, // This ensures Node-level env vars are accessible if needed
      'import.meta.env.VITE_OPENAI_API_KEY': JSON.stringify(env.VITE_OPENAI_API_KEY),
      'import.meta.env.VITE_SIMLI_API_KEY': JSON.stringify(env.VITE_SIMLI_API_KEY),
      'import.meta.env.VITE_ELEVENLABS_API_KEY': JSON.stringify(env.VITE_ELEVENLABS_API_KEY),
    },
  })
}
