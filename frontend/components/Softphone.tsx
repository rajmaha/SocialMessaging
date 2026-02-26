'use client';

import { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Pause, Play, Users, ArrowLeftRight } from 'lucide-react';
// import { UserAgent, Inviter, SessionState, Registerer } from 'sip.js'; // Will be connected later

// Mock SIP Integration until backend credentials can be fully provisioned
export default function Softphone({ telephonySettings }: { user: any, telephonySettings: any }) {
    const [isOpen, setIsOpen] = useState(false);
    const [number, setNumber] = useState('');
    const [callState, setCallState] = useState<'idle' | 'calling' | 'ringing' | 'connected'>('idle');
    const [isMuted, setIsMuted] = useState(false);
    const [isOnHold, setIsOnHold] = useState(false);
    const [duration, setDuration] = useState(0);

    const timerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (callState === 'connected') {
            timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
        } else {
            if (timerRef.current) clearInterval(timerRef.current);
            if (callState === 'idle') setDuration(0);
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [callState]);

    const formatTime = (secs: number) => {
        const mins = Math.floor(secs / 60);
        const s = secs % 60;
        return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const handleCall = () => {
        if (!number) return;
        setCallState('calling');
        // Mock connecting
        setTimeout(() => setCallState('connected'), 2000);
    };

    const handleHangup = () => {
        setCallState('idle');
        setNumber('');
    };

    const dialPad = [
        { num: '1', letters: '' }, { num: '2', letters: 'ABC' }, { num: '3', letters: 'DEF' },
        { num: '4', letters: 'GHI' }, { num: '5', letters: 'JKL' }, { num: '6', letters: 'MNO' },
        { num: '7', letters: 'PQRS' }, { num: '8', letters: 'TUV' }, { num: '9', letters: 'WXYZ' },
        { num: '*', letters: '' }, { num: '0', letters: '+' }, { num: '#', letters: '' }
    ];

    if (!telephonySettings?.is_active) return null;

    return (
        <>
            {/* Floating Toggle Button */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-6 right-6 bg-indigo-600 text-white p-4 rounded-full shadow-lg hover:bg-indigo-700 transition-colors z-50 flex items-center justify-center"
                >
                    <Phone className="w-6 h-6" />
                </button>
            )}

            {/* Softphone Panel */}
            {isOpen && (
                <div className="fixed bottom-6 right-6 w-80 bg-white rounded-2xl shadow-2xl border border-gray-200 z-50 overflow-hidden flex flex-col">
                    {/* Header */}
                    <div className="bg-gray-900 text-white p-4 flex justify-between items-center">
                        <div className="flex items-center space-x-2">
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                            <span className="font-medium text-sm">Agent: Ext 105</span>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white">
                            ✕
                        </button>
                    </div>

                    <div className="p-6 flex-1 flex flex-col bg-gray-50">
                        {/* Display */}
                        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center mb-6 min-h-[100px] flex flex-col justify-center">
                            <div className="text-2xl font-semibold tracking-wide text-gray-800">
                                {number || 'Dial Number'}
                            </div>

                            {callState !== 'idle' && (
                                <div className="mt-2 text-sm text-gray-500 flex items-center justify-center space-x-2">
                                    {callState === 'calling' && <span className="animate-pulse text-indigo-500">Calling...</span>}
                                    {callState === 'connected' && (
                                        <div className="flex items-center space-x-2">
                                            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                                            <span className="text-gray-600">{formatTime(duration)}</span>
                                            {isOnHold && <span className="text-yellow-600 font-medium">ON HOLD</span>}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Dialpad (Hidden during active call to save space, unless requested) */}
                        {callState === 'idle' ? (
                            <div className="grid grid-cols-3 gap-3 mb-6">
                                {dialPad.map((btn, i) => (
                                    <button
                                        key={i}
                                        onClick={() => setNumber(prev => prev + btn.num)}
                                        className="aspect-square rounded-full bg-white border border-gray-200 shadow-sm flex flex-col items-center justify-center hover:bg-gray-50 active:bg-gray-100 transition-colors"
                                    >
                                        <span className="text-xl text-gray-800 font-medium">{btn.num}</span>
                                        {btn.letters && <span className="text-[9px] text-gray-400 uppercase tracking-widest">{btn.letters}</span>}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center space-y-6 py-4">
                                <div className="flex justify-center w-full space-x-6">
                                    {/* Action Buttons */}
                                    <button
                                        onClick={() => setIsMuted(!isMuted)}
                                        className={`p-4 rounded-full flex flex-col items-center justify-center transition-colors ${isMuted ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                    >
                                        {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                                    </button>

                                    <button
                                        onClick={() => setIsOnHold(!isOnHold)}
                                        className={`p-4 rounded-full flex flex-col items-center justify-center transition-colors ${isOnHold ? 'bg-yellow-100 text-yellow-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                                    >
                                        {isOnHold ? <Play className="w-6 h-6" /> : <Pause className="w-6 h-6" />}
                                    </button>
                                </div>

                                <div className="flex justify-center w-full space-x-6">
                                    <button className="p-4 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 flex flex-col items-center justify-center transition-colors" title="Transfer">
                                        <ArrowLeftRight className="w-6 h-6" />
                                    </button>
                                    <button className="p-4 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 flex flex-col items-center justify-center transition-colors" title="Conference">
                                        <Users className="w-6 h-6" />
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Main Action Button */}
                        <div className="flex justify-center mt-auto">
                            {callState === 'idle' ? (
                                <button
                                    onClick={handleCall}
                                    disabled={!number}
                                    className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center text-white shadow-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105"
                                >
                                    <Phone className="w-7 h-7" />
                                </button>
                            ) : (
                                <button
                                    onClick={handleHangup}
                                    className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center text-white shadow-lg hover:bg-red-600 transition-all transform hover:scale-105"
                                >
                                    <PhoneOff className="w-7 h-7" />
                                </button>
                            )}
                        </div>

                        {/* Backspace inside idle state */}
                        {callState === 'idle' && number && (
                            <button
                                onClick={() => setNumber(prev => prev.slice(0, -1))}
                                className="absolute right-12 bottom-12 p-2 text-gray-400 hover:text-gray-600"
                            >
                                ⌫
                            </button>
                        )}

                    </div>
                </div>
            )}
        </>
    );
}
