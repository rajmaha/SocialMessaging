'use client'

import { useState, useEffect } from 'react'
import { Phone, PhoneOff, Mic, MicOff, Pause, Play, X } from 'lucide-react'
import { useSoftphone } from '@/lib/softphone-context'

const DIAL_KEYS = [
  { num: '1', sub: '' }, { num: '2', sub: 'ABC' }, { num: '3', sub: 'DEF' },
  { num: '4', sub: 'GHI' }, { num: '5', sub: 'JKL' }, { num: '6', sub: 'MNO' },
  { num: '7', sub: 'PQRS' }, { num: '8', sub: 'TUV' }, { num: '9', sub: 'WXYZ' },
  { num: '*', sub: '' }, { num: '0', sub: '+' }, { num: '#', sub: '' },
]

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export default function Softphone() {
  const {
    status, callState, callerNumber, remoteDisplayName,
    isOpen, dialNumber,
    dial, answer, hangup, toggleMute, toggleHold, close, setDialNumber,
    callSeconds, isMuted, isOnHold,
  } = useSoftphone()

  const [inputNumber, setInputNumber] = useState('')

  // When context sets dialNumber (click-to-call from ticket table), populate input
  useEffect(() => {
    if (dialNumber) {
      setInputNumber(dialNumber)
      setDialNumber(null)
    }
  }, [dialNumber, setDialNumber])

  if (!isOpen) return null

  const statusDot =
    status === 'registered' ? 'bg-green-400' :
    status === 'registering' ? 'bg-yellow-400 animate-pulse' :
    status === 'error' ? 'bg-red-500' : 'bg-gray-400'

  const statusLabel =
    status === 'registered' ? 'Ready' :
    status === 'registering' ? 'Connecting…' :
    status === 'unauthorized' ? 'Not authorized' :
    status === 'no_extension' ? 'No extension assigned' :
    status === 'error' ? 'Registration failed' : 'Loading…'

  return (
    <div className="fixed bottom-6 right-6 w-80 bg-white rounded-2xl shadow-2xl border border-gray-200 z-50 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="bg-gray-900 text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className="text-sm font-medium">{statusLabel}</span>
        </div>
        <button onClick={close} className="text-gray-400 hover:text-white transition">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-5 flex flex-col gap-4 bg-gray-50">

        {/* Inbound ringing */}
        {callState === 'ringing_in' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="w-14 h-14 rounded-full bg-indigo-100 flex items-center justify-center animate-pulse">
              <Phone className="w-7 h-7 text-indigo-600" />
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Incoming Call</p>
              <p className="text-lg font-semibold text-gray-800 mt-0.5">
                {remoteDisplayName || callerNumber || 'Unknown'}
              </p>
              {remoteDisplayName && (
                <p className="text-sm text-gray-500">{callerNumber}</p>
              )}
            </div>
            <div className="flex gap-4 mt-2">
              <button
                onClick={hangup}
                className="w-12 h-12 rounded-full bg-red-500 flex items-center justify-center text-white hover:bg-red-600 transition"
              >
                <PhoneOff className="w-5 h-5" />
              </button>
              <button
                onClick={answer}
                className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center text-white hover:bg-green-600 transition"
              >
                <Phone className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* Active / outbound ringing */}
        {(callState === 'active' || callState === 'on_hold' || callState === 'ringing_out') && (
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="text-center">
              <p className="text-xs text-gray-400 uppercase tracking-wide">
                {callState === 'ringing_out' ? 'Calling…' :
                 callState === 'on_hold' ? 'On Hold' : 'Active Call'}
              </p>
              <p className="text-lg font-semibold text-gray-800 mt-0.5">
                {remoteDisplayName || callerNumber}
              </p>
              {callState === 'active' && (
                <p className="text-sm font-mono text-gray-500 mt-1">{formatTime(callSeconds)}</p>
              )}
            </div>
            <div className="flex gap-4">
              <button
                onClick={toggleMute}
                title={isMuted ? 'Unmute' : 'Mute'}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition ${
                  isMuted ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
              <button
                onClick={toggleHold}
                title={isOnHold ? 'Resume' : 'Hold'}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition ${
                  isOnHold ? 'bg-yellow-100 text-yellow-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {isOnHold ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
              </button>
              <button
                onClick={hangup}
                title="Hang up"
                className="w-11 h-11 rounded-full bg-red-500 flex items-center justify-center text-white hover:bg-red-600 transition"
              >
                <PhoneOff className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* Idle — dial pad */}
        {callState === 'idle' && (
          <>
            {/* Number input */}
            <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-200 px-3 py-2 shadow-sm">
              <input
                type="tel"
                value={inputNumber}
                onChange={e => setInputNumber(e.target.value)}
                placeholder="Enter number…"
                className="flex-1 text-lg font-semibold text-gray-800 focus:outline-none bg-transparent"
              />
              {inputNumber && (
                <button
                  onClick={() => setInputNumber(p => p.slice(0, -1))}
                  className="text-gray-400 hover:text-gray-600 text-lg"
                >⌫</button>
              )}
            </div>

            {/* Dial pad */}
            <div className="grid grid-cols-3 gap-2">
              {DIAL_KEYS.map(k => (
                <button
                  key={k.num}
                  onClick={() => setInputNumber(p => p + k.num)}
                  className="aspect-square rounded-full bg-white border border-gray-200 shadow-sm flex flex-col items-center justify-center hover:bg-gray-50 active:bg-gray-100 transition"
                >
                  <span className="text-lg font-semibold text-gray-800">{k.num}</span>
                  {k.sub && <span className="text-[9px] text-gray-400 uppercase tracking-widest">{k.sub}</span>}
                </button>
              ))}
            </div>

            {/* Call button */}
            <div className="flex justify-center mt-1">
              <button
                onClick={() => { if (inputNumber) dial(inputNumber) }}
                disabled={!inputNumber || status !== 'registered'}
                className="w-14 h-14 rounded-full bg-green-500 flex items-center justify-center text-white shadow-lg hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed transition hover:scale-105 transform"
              >
                <Phone className="w-6 h-6" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
