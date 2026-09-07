/**
 * audio — 《暖流计划》合成音效注册（audioSys synth，无外部音频文件）
 * 拉线 whoosh / 合法 ding / 非法 buzz / 卸货上扬 / 选卡 / 告警 / 耀斑 / 造船 / 胜负
 */
import { audioSys } from '@/engine'

const CLIPS = [
  { id: 'wc.draw', synth: { kind: 'noise', duration: 0.12, gain: 0.2, filter: { type: 'bandpass', freq: 1800, q: 1.2 } } },
  { id: 'wc.ok', synth: { kind: 'osc', waveform: 'sine', freqFrom: 880, freqTo: 880, duration: 0.12, gain: 0.25 } },
  { id: 'wc.bad', synth: { kind: 'osc', waveform: 'square', freqFrom: 140, freqTo: 90, duration: 0.18, gain: 0.2 } },
  { id: 'wc.unload', synth: { kind: 'osc', waveform: 'sine', freqFrom: 520, freqTo: 900, duration: 0.22, gain: 0.28 } },
  { id: 'wc.card', synth: { kind: 'osc', waveform: 'triangle', freqFrom: 660, freqTo: 1320, duration: 0.3, gain: 0.3 } },
  { id: 'wc.alarm', synth: { kind: 'osc', waveform: 'sawtooth', freqFrom: 220, freqTo: 440, duration: 0.4, gain: 0.22 } },
  { id: 'wc.flare', synth: { kind: 'noise', duration: 1.2, gain: 0.35, filter: { type: 'lowpass', freq: 220, q: 0.8 } } },
  { id: 'wc.build', synth: { kind: 'osc', waveform: 'square', freqFrom: 180, freqTo: 60, duration: 0.2, gain: 0.25 } },
  { id: 'wc.win', synth: { kind: 'osc', waveform: 'sine', freqFrom: 440, freqTo: 1760, duration: 1.2, gain: 0.35 } },
  { id: 'wc.lose', synth: { kind: 'osc', waveform: 'sawtooth', freqFrom: 330, freqTo: 55, duration: 1.6, gain: 0.35 } },
] as const

let registered = false

export function registerWarmCurrentAudio(): void {
  if (registered) return
  registered = true
  audioSys.registerClips(CLIPS as unknown as Parameters<typeof audioSys.registerClips>[0])
}
