export class EngineAudio {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private engine: OscillatorNode | null = null
  private engineGain: GainNode | null = null
  private filter: BiquadFilterNode | null = null
  private skidGain: GainNode | null = null
  private volume = 0.7
  private lastImpact = 0
  ready = false

  setVolume(volume: number) {
    this.volume = volume
    if (this.master) this.master.gain.value = 0.2 * volume
  }

  start() {
    if (this.ready) {
      void this.context?.resume()
      return
    }
    const context = new AudioContext()
    const master = context.createGain()
    master.gain.value = 0.2 * this.volume
    master.connect(context.destination)

    const engine = context.createOscillator()
    engine.type = 'sawtooth'
    const engineGain = context.createGain()
    engineGain.gain.value = 0
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 400
    engine.connect(filter)
    filter.connect(engineGain)
    engineGain.connect(master)
    engine.start()

    const noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
    const noise = context.createBufferSource()
    noise.buffer = noiseBuffer
    noise.loop = true
    const band = context.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 900
    const skidGain = context.createGain()
    skidGain.gain.value = 0
    noise.connect(band)
    band.connect(skidGain)
    skidGain.connect(master)
    noise.start()

    this.context = context
    this.master = master
    this.engine = engine
    this.engineGain = engineGain
    this.filter = filter
    this.skidGain = skidGain
    this.ready = true
  }

  update(speed: number, throttle: number, slip: number, active: boolean) {
    if (!this.engine || !this.engineGain || !this.filter || !this.skidGain) return
    const now = this.context?.currentTime ?? 0
    const rpm = 28 + Math.abs(speed) * 1.7 + throttle * 22
    this.engine.frequency.setTargetAtTime(rpm, now, 0.05)
    this.filter.frequency.setTargetAtTime(280 + throttle * 1600 + Math.abs(speed) * 18, now, 0.05)
    const engineLevel = active ? 0.03 + throttle * 0.07 + Math.min(0.05, Math.abs(speed) * 0.001) : 0
    this.engineGain.gain.setTargetAtTime(engineLevel, now, 0.05)
    const skid = active ? Math.max(0, Math.min(1, (slip - 2.5) / 7)) * 0.12 : 0
    this.skidGain.gain.setTargetAtTime(skid, now, 0.05)
  }

  impact(force: number) {
    if (!this.context || !this.master || force < 4) return
    const now = this.context.currentTime
    if (now - this.lastImpact < 0.18) return
    this.lastImpact = now
    const osc = this.context.createOscillator()
    const gain = this.context.createGain()
    osc.frequency.setValueAtTime(90 + force * 3, now)
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.18)
    gain.gain.setValueAtTime(Math.min(0.25, force * 0.012) * this.volume, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22)
    osc.connect(gain)
    gain.connect(this.master)
    osc.start(now)
    osc.stop(now + 0.24)
  }
}
