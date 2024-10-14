import { EventEmitter } from 'eventemitter3'

export interface SimliClientConfig {
  apiKey: string
  faceID: string
  handleSilence: boolean
  videoRef: React.RefObject<HTMLVideoElement>
  audioRef: React.RefObject<HTMLAudioElement>
}

export class SimliClient extends EventEmitter {
  private pc: RTCPeerConnection | null = null
  private dc: RTCDataChannel | null = null
  private dcInterval: NodeJS.Timeout | null = null
  private candidateCount: number = 0
  private prevCandidateCount: number = -1
  private apiKey: string = ''
  private faceID: string = ''
  private handleSilence: boolean = true
  private videoRef: React.RefObject<HTMLVideoElement> | null = null
  private audioRef: React.RefObject<HTMLAudioElement> | null = null

  constructor() {
    super()
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.handleBeforeUnload)
      window.addEventListener('pagehide', this.handlePageHide)
    }
  }

  public Initialize(config: SimliClientConfig) {
    this.apiKey = config.apiKey
    this.faceID = config.faceID
    this.handleSilence = config.handleSilence
    if (typeof window !== 'undefined') {
      this.videoRef = config.videoRef
      this.audioRef = config.audioRef
    } else {
      console.warn('Running in Node.js environment. Some features may not be available.')
    }
  }

  private createPeerConnection() {
    const config: RTCConfiguration = {
      iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
    }
    // console.log('Server running: ', config.iceServers)

    this.pc = new window.RTCPeerConnection(config)

    if (this.pc) {
      this.setupPeerConnectionListeners()
    }
  }

  private setupPeerConnectionListeners() {
    if (!this.pc) return

    this.pc.addEventListener('icegatheringstatechange', () => {
      console.log('ICE gathering state changed: ', this.pc?.iceGatheringState)
    })

    this.pc.addEventListener('iceconnectionstatechange', () => {
      console.log('ICE connection state changed: ', this.pc?.iceConnectionState)
    })

    this.pc.addEventListener('signalingstatechange', () => {
      console.log('Signaling state changed: ', this.pc?.signalingState)
    })

    this.pc.addEventListener('track', (evt) => {
      // console.log('Track event: ', evt.track.kind)
      if (evt.track.kind === 'video' && this.videoRef?.current) {
        this.videoRef.current.srcObject = evt.streams[0]
      } else if (evt.track.kind === 'audio' && this.audioRef?.current) {
        this.audioRef.current.srcObject = evt.streams[0]
      }
    })

    this.pc.onicecandidate = (event) => {
      if (event.candidate === null) {
        console.log(JSON.stringify(this.pc?.localDescription))
      } else {
        console.log(event.candidate)
        this.candidateCount += 1
      }
    }
  }

  async start() {
    await this.createPeerConnection()

    const parameters = { ordered: true }
    this.dc = this.pc!.createDataChannel('chat', parameters)

    this.setupDataChannelListeners()
    this.pc?.addTransceiver('audio', { direction: 'recvonly' })
    this.pc?.addTransceiver('video', { direction: 'recvonly' })

    await this.negotiate()
  }

  private setupDataChannelListeners() {
    if (!this.dc) return

    this.dc.addEventListener('close', () => {
      console.log('Data channel closed')
      this.emit('disconnected')
      this.stopDataChannelInterval()
    })

    this.dc.addEventListener('open', async () => {
      console.log('Data channel opened')
      this.emit('connected')
      await this.initializeSession()

      this.startDataChannelInterval()
    })

    this.dc.addEventListener('message', (evt) => {
      // console.log('Received message: ', evt.data)

      if (evt.data.includes('START')) {
        this.emit('started')
      }

      if (evt.data === 'Session Intialization not done, Ignoring audio') {
        this.emit('failed')
      }
    })
  }

  private startDataChannelInterval() {
    this.stopDataChannelInterval() // Clear any existing interval
    this.dcInterval = setInterval(() => {
      this.sendPingMessage()
    }, 1000)
  }

  private stopDataChannelInterval() {
    if (this.dcInterval) {
      clearInterval(this.dcInterval)
      this.dcInterval = null
    }
  }

  private sendPingMessage() {
    if (this.dc && this.dc.readyState === 'open') {
      const message = 'ping ' + Date.now()
      try {
        this.dc.send(message)
      } catch (error) {
        console.error('Failed to send message:', error)
        this.stopDataChannelInterval()
      }
    } else {
      console.warn('Data channel is not open. Current state:', this.dc?.readyState)
      this.stopDataChannelInterval()
    }
  }

  private async initializeSession() {
    const metadata = {
      faceId: this.faceID,
      isJPG: false,
      apiKey: this.apiKey,
      syncAudio: true,
      handleSilence: this.handleSilence,
    }

    try {
      const response = await fetch('https://api.simli.ai/startAudioToVideoSession', {
        method: 'POST',
        body: JSON.stringify(metadata),
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const resJSON = await response.json()
      if (this.dc && this.dc.readyState === 'open') {
        this.dc.send(resJSON.session_token)
      } else {
        this.emit('failed')
        console.error('Data channel not open when trying to send session token')
      }
    } catch (error) {
      this.emit('failed')
      console.error('Failed to initialize session:', error)
    }
  }

  private async negotiate() {
    if (!this.pc) {
      throw new Error('PeerConnection not initialized')
    }

    try {
      const offer = await this.pc.createOffer()
      await this.pc.setLocalDescription(offer)

      await this.waitForIceGathering()

      const localDescription = this.pc.localDescription
      if (!localDescription) return

      const response = await fetch('https://api.simli.ai/StartWebRTCSession', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sdp: localDescription.sdp,
          type: localDescription.type,
          video_transform: 'none',
        }),
      })

      const answer = await response.json()
      await this.pc.setRemoteDescription(new RTCSessionDescription(answer))
    } catch (e) {
      console.error('Negotiation failed:', e)
      this.emit('failed')
    }
  }

  private async waitForIceGathering(): Promise<void> {
    if (!this.pc) return

    if (this.pc.iceGatheringState === 'complete') {
      return
    }

    return new Promise<void>((resolve) => {
      const checkIceCandidates = () => {
        if (
          this.pc?.iceGatheringState === 'complete' ||
          this.candidateCount === this.prevCandidateCount
        ) {
          // console.log(this.pc?.iceGatheringState, this.candidateCount)
          resolve()
        } else {
          this.prevCandidateCount = this.candidateCount
          setTimeout(checkIceCandidates, 250)
        }
      }

      checkIceCandidates()
    })
  }

  sendAudioData(audioData: Uint8Array) {
    if (this.dc && this.dc.readyState === 'open') {
      try {
        this.dc.send(audioData)
      } catch (error) {
        console.error('Failed to send audio data:', error)
      }
    } else {
      console.error('Data channel is not open. Current state:', this.dc?.readyState)
    }
  }

  close() {
    this.emit('disconnected')
    this.stopDataChannelInterval()

    // close data channel
    if (this.dc) {
      this.dc.close()
    }

    // close transceivers
    if (this.pc?.getTransceivers) {
      this.pc.getTransceivers().forEach((transceiver) => {
        if (transceiver.stop) {
          transceiver.stop()
        }
      })
    }

    // close local audio / video
    this.pc?.getSenders().forEach((sender) => {
      sender.track?.stop()
    })

    // close peer connection
    this.pc?.close()

    // Cleanup
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.handleBeforeUnload)
      window.removeEventListener('pagehide', this.handlePageHide)
    }
  }

  private handleBeforeUnload = (event: BeforeUnloadEvent) => {
    this.close()
    event.preventDefault()
    event.returnValue = ''
  }

  private handlePageHide = (event: PageTransitionEvent) => {
    if (event.persisted) {
      // The page is being cached for bfcache
      this.close()
    } else {
      // The page is being unloaded
      this.close()
    }
  }
}
