import type { ReliableMsg } from './protocol'

export const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

export interface PeerSignal {
  sdp?: RTCSessionDescriptionInit
  ice?: RTCIceCandidateInit
}

/**
 * One WebRTC connection (client ↔ host) with two pre-negotiated data channels:
 * `reliable` (ordered JSON) and `state` (unordered, maxRetransmits 0, binary).
 * The client is the offerer; offers/answers/ICE travel over the lobby's signalling channel.
 */
export class PeerLink {
  readonly pc: RTCPeerConnection
  readonly reliable: RTCDataChannel
  readonly state: RTCDataChannel
  onReliable: (msg: ReliableMsg) => void = () => {}
  onState: (buf: ArrayBuffer) => void = () => {}
  onOpen: () => void = () => {}
  onClose: () => void = () => {}
  /** Smoothed round-trip time in ms. */
  rtt = 0
  bytesOut = 0
  bytesIn = 0
  open = false
  private closed = false
  private pendingIce: RTCIceCandidateInit[] = []
  private haveRemote = false

  constructor(
    private signal: (s: PeerSignal) => void,
    initiator: boolean,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    this.reliable = this.pc.createDataChannel('reliable', { negotiated: true, id: 0, ordered: true })
    this.state = this.pc.createDataChannel('state', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 })
    this.state.binaryType = 'arraybuffer'
    this.reliable.onmessage = (e) => {
      this.bytesIn += (e.data as string).length
      try {
        this.onReliable(JSON.parse(e.data as string) as ReliableMsg)
      } catch (err) {
        console.warn('[net] bad reliable message', err)
      }
    }
    this.state.onmessage = (e) => {
      const buf = e.data as ArrayBuffer
      this.bytesIn += buf.byteLength
      this.onState(buf)
    }
    let opened = 0
    const onOpen = () => {
      if (++opened === 2) {
        this.open = true
        this.onOpen()
      }
    }
    this.reliable.onopen = onOpen
    this.state.onopen = onOpen
    this.reliable.onclose = () => this.close()
    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.signal({ ice: e.candidate.toJSON() })
    }
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState
      if (s === 'failed' || s === 'closed') this.close()
    }
    if (initiator) void this.makeOffer()
  }

  private async makeOffer() {
    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)
    this.signal({ sdp: this.pc.localDescription!.toJSON() })
  }

  async handleSignal(s: PeerSignal) {
    if (this.closed) return
    try {
      if (s.sdp) {
        await this.pc.setRemoteDescription(s.sdp)
        this.haveRemote = true
        for (const c of this.pendingIce.splice(0)) await this.pc.addIceCandidate(c)
        if (s.sdp.type === 'offer') {
          const answer = await this.pc.createAnswer()
          await this.pc.setLocalDescription(answer)
          this.signal({ sdp: this.pc.localDescription!.toJSON() })
        }
      } else if (s.ice) {
        if (this.haveRemote) await this.pc.addIceCandidate(s.ice)
        else this.pendingIce.push(s.ice)
      }
    } catch (err) {
      console.warn('[net] signalling error', err)
    }
  }

  sendReliable(msg: ReliableMsg) {
    if (this.reliable.readyState !== 'open') return
    const s = JSON.stringify(msg)
    this.bytesOut += s.length
    this.reliable.send(s)
  }

  sendState(buf: ArrayBuffer) {
    if (this.state.readyState !== 'open') return
    // Drop rather than queue when congested: state is superseded 20-30 times a second.
    if (this.state.bufferedAmount > 64 * 1024) return
    this.bytesOut += buf.byteLength
    this.state.send(buf)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.open = false
    try {
      this.reliable.close()
      this.state.close()
      this.pc.close()
    } catch {
      /* already closed */
    }
    this.onClose()
  }
}
