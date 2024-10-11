import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import axios from 'axios'

import { e11, oai, sk } from './k'
import { SimliClient } from './SimliClient'

import './styles.css'

const SIMLI_FACE_ID = '13fbb3e1-4489-4199-ad57-91be4a2dd38b'
const ELEVENLABS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'

const simliClient = new SimliClient()

const App = () => {
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [_, setChatgptText] = useState('')
  const [startWebRTC, setStartWebRTC] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const cancelTokenRef = useRef<any | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioContextRef = useRef<any | null>(null)
  const analyserRef = useRef<any | null>(null)
  const microphoneRef = useRef<any | null>(null)

  const initializeSimliClient = useCallback(() => {
    if (videoRef.current && audioRef.current) {
      const SimliConfig = {
        apiKey: sk as string,
        faceID: SIMLI_FACE_ID,
        handleSilence: true,
        videoRef: videoRef,
        audioRef: audioRef,
      }

      simliClient.Initialize(SimliConfig)
      console.log('Simli Client initialized')
    }
  }, [])

  useEffect(() => {
    initializeSimliClient()

    const handleConnected = () => {
      setIsLoading(false)
      console.log('SimliClient is now connected!')
    }

    const handleDisconnected = () => {
      console.log('SimliClient has disconnected!')
    }

    const handleFailed = () => {
      console.log('SimliClient has failed to connect!')
      setError('Failed to connect to Simli. Please try again.')
    }

    simliClient.on('connected', handleConnected)
    simliClient.on('disconnected', handleDisconnected)
    simliClient.on('failed', handleFailed)

    return () => {
      simliClient.off('connected', handleConnected)
      simliClient.off('disconnected', handleDisconnected)
      simliClient.off('failed', handleFailed)
      simliClient.close()
    }
  }, [initializeSimliClient])

  const handleStart = useCallback(() => {
    simliClient.start()
    setStartWebRTC(true)
    setIsLoading(true)

    setTimeout(() => {
      const audioData = new Uint8Array(6000).fill(0)
      simliClient.sendAudioData(audioData)
    }, 4000)
  }, [])

  const processInput = useCallback(async (text: any) => {
    setIsLoading(true)
    setError('')

    if (cancelTokenRef.current) {
      cancelTokenRef.current.cancel('Operation canceled by the user.')
    }

    cancelTokenRef.current = axios.CancelToken.source()

    try {
      const chatGPTResponse = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: text }],
        },
        {
          headers: {
            'Authorization': `Bearer ${oai}`,
            'Content-Type': 'application/json',
          },
          cancelToken: cancelTokenRef.current.token,
        }
      )

      const chatGPTText = chatGPTResponse.data.choices[0].message.content
      setChatgptText(chatGPTText)

      const elevenlabsResponse = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=pcm_16000`,
        {
          text: chatGPTText,
          model_id: 'eleven_multilingual_v1',
        },
        {
          headers: {
            'xi-api-key': e11,
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
          cancelToken: cancelTokenRef.current.token,
        }
      )

      const pcm16Data = new Uint8Array(elevenlabsResponse.data)
      const chunkSize = 6000
      for (let i = 0; i < pcm16Data.length; i += chunkSize) {
        const chunk = pcm16Data.slice(i, i + chunkSize)
        simliClient.sendAudioData(chunk)
      }
    } catch (err) {
      if (axios.isCancel(err)) {
        console.log('Request canceled:', err.message)
      } else {
        setError('An error occurred. Please try again.')
        console.error(err)
      }
    } finally {
      setIsLoading(false)
      cancelTokenRef.current = null
    }
  }, [])

  const toggleListening = useCallback(() => {
    if (isListening) {
      console.log('Stopping mic')
      stopListening()
    } else {
      console.log('Starting mic')
      startListening()
    }
  }, [isListening])

  const sendAudioToWhisper = useCallback(
    async (audioBlob: Blob) => {
      const formData = new FormData()
      formData.append('file', audioBlob, 'audio.wav')
      formData.append('model', 'whisper-1')

      try {
        const response = await axios.post(
          'https://api.openai.com/v1/audio/transcriptions',
          formData,
          {
            headers: {
              'Authorization': `Bearer ${oai}`,
              'Content-Type': 'multipart/form-data',
            },
          }
        )

        const transcribedText = response.data.text
        await processInput(transcribedText)
      } catch (error) {
        console.error('Error transcribing audio:', error)
        setError('Error transcribing audio. Please try again.')
      }
    },
    [processInput]
  )

  const startListening = useCallback(() => {
    setIsListening(true)
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext ||
            (window as any).webkitAudioContext)()
        }

        if (!analyserRef.current) {
          analyserRef.current = audioContextRef.current.createAnalyser()
          analyserRef.current.fftSize = 512
        }

        if (microphoneRef.current) {
          microphoneRef.current.disconnect()
        }

        microphoneRef.current = audioContextRef.current.createMediaStreamSource(stream)
        microphoneRef.current.connect(analyserRef.current)

        mediaRecorderRef.current = new MediaRecorder(stream)
        mediaRecorderRef.current.ondataavailable = (event) => {
          console.log('Data available:', event.data)
          chunksRef.current.push(event.data)
        }
        mediaRecorderRef.current.onstop = () => {
          console.log('Recorder stopped')
          const audioBlob = new Blob(chunksRef.current, { type: 'audio/wav' })
          sendAudioToWhisper(audioBlob)
          chunksRef.current = []
        }
        mediaRecorderRef.current.start()
      })
      .catch((err) => {
        console.error('Error accessing microphone:', err)
        setIsListening(false)
        setError('Error accessing microphone. Please check your permissions and try again.')
      })
  }, [sendAudioToWhisper])

  const stopListening = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    console.log('Stopping listening')
    setIsListening(false)
  }, [])

  useEffect(() => {
    console.log('isListening', isListening)
    console.log('chunksRef.current', chunksRef.current)

    if (!isListening && chunksRef.current.length > 0) {
      console.log('Sending audio to Whisper')
      const audioBlob = new Blob(chunksRef.current, { type: 'audio/wav' })
      sendAudioToWhisper(audioBlob)
      chunksRef.current = []
    }
  }, [isListening, sendAudioToWhisper])

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      await processInput(inputText)
      setInputText('')
    },
    [inputText, processInput]
  )

  return (
    <>
      <div className='flex h-screen w-full flex-col items-center justify-center font-mono text-white'>
        <div className='relative size-full'>
          <video
            ref={videoRef}
            id='simli_video'
            autoPlay
            playsInline
            className='size-full object-cover'
          ></video>
          <audio ref={audioRef} id='simli_audio' autoPlay></audio>
        </div>
        {startWebRTC ? (
          <>
            {/* {chatgptText && <p className='text-center'>{chatgptText}</p>} */}
            <form
              onSubmit={handleSubmit}
              className='fixed bottom-4 mx-4 w-full max-w-md space-y-4 px-4'
            >
              <div className='flex w-full items-center space-x-2'>
                <input
                  type='text'
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder='Enter your message'
                  className='grow rounded border border-white bg-black px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white'
                />
                <button
                  type='submit'
                  disabled={isLoading || !inputText.trim()}
                  className='rounded bg-white px-3 py-1 text-3xl text-black transition-colors hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black disabled:opacity-50'
                >
                  {isLoading ? '➡️' : '➡️'}
                </button>
                <button
                  type='button'
                  onClick={toggleListening}
                  className='rounded bg-blue-500 px-3 py-1 text-2xl text-white transition-colors hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-black'
                >
                  {isListening ? '🔴' : '🎤'}
                </button>
              </div>
            </form>
          </>
        ) : (
          <button
            onClick={handleStart}
            className='fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-white px-4 py-2 text-black transition-colors hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black'
          >
            Start
          </button>
        )}
        {error && <p className='fixed bottom-20 mt-4 text-center text-red-500'>{error}</p>}
      </div>
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundImage: 'url(./bg.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          zIndex: -1000,
        }}
      />
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
