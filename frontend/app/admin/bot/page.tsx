'use client'

import MainHeader from '@/components/MainHeader';
import { authAPI } from '@/lib/auth';

import { useState, useEffect } from 'react'
import { getAuthToken } from '@/lib/auth'
import AdminNav from '@/components/AdminNav'
import { API_URL } from '@/lib/config';

interface BotConfig {
  enabled: boolean
  bot_name: string
  welcome_message: string
  handoff_message: string
  handoff_after: number
}

interface QA {
  id: number
  question: string
  keywords: string
  answer: string
  order: number
  enabled: boolean
}

interface AIConfig {
  enabled: boolean
  provider: string
  api_key: string
  model_name: string
  ollama_url: string
  system_prompt: string
}

export default function BotSettingsPage() {
  const user = authAPI.getUser();
  const [config, setConfig] = useState<BotConfig>({
    enabled: false,
    bot_name: 'Support Bot',
    welcome_message: '👋 Hi! I\'m the support bot. How can I help you today?',
    handoff_message: 'Let me connect you with a human agent. Someone will be with you shortly.',
    handoff_after: 3,
  })
  const [qas, setQAs] = useState<QA[]>([])
  const [savingConfig, setSavingConfig] = useState(false)
  const [configSaved, setConfigSaved] = useState(false)
  // AI provider config
  const [aiConfig, setAiConfig] = useState<AIConfig>({
    enabled: false,
    provider: 'none',
    api_key: '',
    model_name: '',
    ollama_url: 'http://localhost:11434',
    system_prompt: '',
  })
  const [savingAI, setSavingAI] = useState(false)
  const [aiSaved, setAiSaved] = useState(false)
  // New Q&A form
  const [newQuestion, setNewQuestion] = useState('')
  const [newKeywords, setNewKeywords] = useState('')
  const [newAnswer, setNewAnswer] = useState('')
  const [addingQA, setAddingQA] = useState(false)
  // Inline edit state
  const [editId, setEditId] = useState<number | null>(null)
  const [editQuestion, setEditQuestion] = useState('')
  const [editKeywords, setEditKeywords] = useState('')
  const [editAnswer, setEditAnswer] = useState('')

  const headers = () => {
    const token = getAuthToken()
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  }

  useEffect(() => {
    fetchConfig()
    fetchQAs()
    fetchAIConfig()
  }, [])

  const fetchConfig = async () => {
    const r = await fetch(`${API_URL}/bot/config`, { headers: headers() })
    if (r.ok) setConfig(await r.json())
  }

  const fetchAIConfig = async () => {
    const r = await fetch(`${API_URL}/bot/ai-config`, { headers: headers() })
    if (r.ok) setAiConfig(await r.json())
  }

  const fetchQAs = async () => {
    const r = await fetch(`${API_URL}/bot/qa`, { headers: headers() })
    if (r.ok) setQAs(await r.json())
  }

  const saveConfig = async () => {
    setSavingConfig(true)
    await fetch(`${API_URL}/bot/config`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(config),
    })
    setSavingConfig(false)
    setConfigSaved(true)
    setTimeout(() => setConfigSaved(false), 2000)
  }

  const saveAIConfig = async () => {
    setSavingAI(true)
    await fetch(`${API_URL}/bot/ai-config`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(aiConfig),
    })
    setSavingAI(false)
    setAiSaved(true)
    setTimeout(() => setAiSaved(false), 2000)
  }

  const addQA = async () => {
    if (!newKeywords.trim() || !newAnswer.trim()) return
    setAddingQA(true)
    const r = await fetch(`${API_URL}/bot/qa`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ question: newQuestion, keywords: newKeywords, answer: newAnswer, order: qas.length }),
    })
    if (r.ok) {
      setNewQuestion('')
      setNewKeywords('')
      setNewAnswer('')
      fetchQAs()
    }
    setAddingQA(false)
  }

  const toggleQA = async (qa: QA) => {
    await fetch(`${API_URL}/bot/qa/${qa.id}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ enabled: !qa.enabled }),
    })
    fetchQAs()
  }

  const deleteQA = async (id: number) => {
    if (!confirm('Delete this Q&A?')) return
    await fetch(`${API_URL}/bot/qa/${id}`, { method: 'DELETE', headers: headers() })
    fetchQAs()
  }

  const saveEdit = async (id: number) => {
    await fetch(`${API_URL}/bot/qa/${id}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ question: editQuestion, keywords: editKeywords, answer: editAnswer }),
    })
    setEditId(null)
    fetchQAs()
  }

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-100">
      <MainHeader user={user!} />
      <AdminNav />
      <div className="max-w-3xl mx-auto py-8 px-4 space-y-8">
        <h1 className="text-2xl font-bold text-gray-800">🤖 Chat Bot Settings</h1>

        {/* ── Bot Config ──────────────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl shadow p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-700">General</h2>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <span className="text-sm text-gray-600">Bot enabled</span>
              <div
                onClick={() => setConfig((c) => ({ ...c, enabled: !c.enabled }))}
                className={`relative w-11 h-6 rounded-full transition-colors ${config.enabled ? 'bg-blue-500' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${config.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </div>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Bot name</label>
              <input
                value={config.bot_name}
                onChange={(e) => setConfig((c) => ({ ...c, bot_name: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">
                Welcome message <span className="text-gray-400">(sent when a new visitor opens chat)</span>
              </label>
              <textarea
                value={config.welcome_message}
                onChange={(e) => setConfig((c) => ({ ...c, welcome_message: e.target.value }))}
                rows={2}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">
                Handoff message <span className="text-gray-400">(sent when bot can't answer N times in a row)</span>
              </label>
              <textarea
                value={config.handoff_message}
                onChange={(e) => setConfig((c) => ({ ...c, handoff_message: e.target.value }))}
                rows={2}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">
                Auto-handoff after <span className="text-gray-400">(unmatched messages; 0 = never)</span>
              </label>
              <input
                type="number" min={0} max={20}
                value={config.handoff_after}
                onChange={(e) => setConfig((c) => ({ ...c, handoff_after: Number(e.target.value) }))}
                className="w-28 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>

          <button
            onClick={saveConfig}
            disabled={savingConfig}
            className="bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white px-5 py-2 rounded-lg text-sm font-medium transition"
          >
            {configSaved ? '✓ Saved' : savingConfig ? 'Saving…' : 'Save settings'}
          </button>
        </section>

        {/* ── AI Provider ───────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl shadow p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-700">AI Provider</h2>
              <p className="text-xs text-gray-400 mt-0.5">Fallback when no keyword matches — understands paraphrased questions</p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <span className="text-sm text-gray-600">AI enabled</span>
              <div
                onClick={() => setAiConfig((c) => ({ ...c, enabled: !c.enabled }))}
                className={`relative w-11 h-6 rounded-full transition-colors ${aiConfig.enabled ? 'bg-purple-500' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${aiConfig.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </div>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Provider</label>
              <select
                value={aiConfig.provider}
                onChange={(e) => setAiConfig((c) => ({ ...c, provider: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              >
                <option value="none">None (disabled)</option>
                <option value="groq">Groq — free tier, very fast (cloud)</option>
                <option value="gemini">Google Gemini — free tier (cloud)</option>
                <option value="ollama">Ollama — self-hosted / local</option>
              </select>
            </div>

            {aiConfig.provider !== 'none' && aiConfig.provider !== 'ollama' && (
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">API Key</label>
                <input
                  type="password"
                  value={aiConfig.api_key}
                  onChange={(e) => setAiConfig((c) => ({ ...c, api_key: e.target.value }))}
                  placeholder={aiConfig.provider === 'groq' ? 'gsk_...' : 'AIza...'}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-400"
                />
                <p className="text-xs text-gray-400 mt-1">
                  {aiConfig.provider === 'groq' && (<>Get free key at <a href="https://console.groq.com" target="_blank" rel="noreferrer" className="underline">console.groq.com</a></>)}
                  {aiConfig.provider === 'gemini' && (<>Get free key at <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" className="underline">aistudio.google.com</a></>)}
                </p>
              </div>
            )}

            {aiConfig.provider === 'ollama' && (
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Ollama URL</label>
                <input
                  value={aiConfig.ollama_url}
                  onChange={(e) => setAiConfig((c) => ({ ...c, ollama_url: e.target.value }))}
                  placeholder="http://localhost:11434"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-400"
                />
              </div>
            )}

            {aiConfig.provider !== 'none' && aiConfig.provider !== 'ollama' && (
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  value={aiConfig.api_key}
                  onChange={(e) => setAiConfig((c) => ({ ...c, api_key: e.target.value }))}
                  placeholder={aiConfig.provider === 'groq' ? 'gsk_...' : 'AIza...'}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                />
              </div>
            )}

            {aiConfig.provider === 'ollama' && (
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  Ollama URL
                </label>
                <input
                  value={aiConfig.ollama_url}
                  onChange={(e) => setAiConfig((c) => ({ ...c, ollama_url: e.target.value }))}
                  placeholder="http://localhost:11434"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                />
              </div>
            )}

            {aiConfig.provider !== 'none' && (
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  Model{' '}
                  <span className="font-normal text-gray-400">
                    {aiConfig.provider === 'groq' && '(e.g. llama-3.1-8b-instant)'}
                    {aiConfig.provider === 'gemini' && '(e.g. gemini-1.5-flash)'}
                    {aiConfig.provider === 'ollama' && '(e.g. mistral)'}
                  </span>
                </label>
                <input
                  value={aiConfig.model_name}
                  onChange={(e) => setAiConfig((c) => ({ ...c, model_name: e.target.value }))}
                  placeholder={
                    aiConfig.provider === 'groq' ? 'llama-3.1-8b-instant' :
                      aiConfig.provider === 'gemini' ? 'gemini-1.5-flash' : 'mistral'
                  }
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                />
              </div>
            )}

            {aiConfig.provider !== 'none' && (
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  System prompt{' '}
                  <span className="font-normal text-gray-400">(personality &amp; scope; Q&amp;A knowledge base is appended automatically)</span>
                </label>
                <textarea
                  value={aiConfig.system_prompt}
                  onChange={(e) => setAiConfig((c) => ({ ...c, system_prompt: e.target.value }))}
                  placeholder="You are a helpful customer support assistant for [Company]. Answer concisely and politely. If you don't know something, say so."
                  rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none"
                />
              </div>
            )}
          </div>

          <button
            onClick={saveAIConfig}
            disabled={savingAI}
            className="bg-purple-500 hover:bg-purple-600 disabled:opacity-60 text-white px-5 py-2 rounded-lg text-sm font-medium transition"
          >
            {aiSaved ? '✓ Saved' : savingAI ? 'Saving…' : 'Save AI settings'}
          </button>
        </section>

        {/* ── Q&A Pairs ─────────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl shadow p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-700">Q&amp;A Pairs</h2>
          <p className="text-sm text-gray-500">
            When a visitor message contains any keyword, the bot replies with the answer.
            Multiple keywords can be separated by commas (e.g. <code className="bg-gray-100 px-1 rounded">hello, hi, hey</code>).
          </p>

          {/* Existing Q&As */}
          <div className="space-y-3">
            {qas.length === 0 && (
              <p className="text-sm text-gray-400 italic">No Q&amp;A pairs yet. Add one below.</p>
            )}
            {qas.map((qa) => (
              <div key={qa.id} className={`border rounded-xl p-4 space-y-2 ${qa.enabled ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
                {editId === qa.id ? (
                  <>
                    <div>
                      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Question label <span className="text-gray-400 normal-case">(shown as button when multiple matches)</span></label>
                      <input
                        value={editQuestion}
                        onChange={(e) => setEditQuestion(e.target.value)}
                        placeholder="e.g. How do I reset my password?"
                        className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Keywords</label>
                      <input
                        value={editKeywords}
                        onChange={(e) => setEditKeywords(e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Answer</label>
                      <textarea
                        value={editAnswer}
                        onChange={(e) => setEditAnswer(e.target.value)}
                        rows={3}
                        className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => saveEdit(qa.id)} className="bg-blue-500 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-blue-600">Save</button>
                      <button onClick={() => setEditId(null)} className="text-xs px-3 py-1.5 rounded-lg border hover:bg-gray-50">Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {qa.question && (
                          <p className="text-sm font-medium text-gray-800 mb-1">{qa.question}</p>
                        )}
                        <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">Keywords</p>
                        <p className="text-sm text-gray-700 break-words">{qa.keywords}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => toggleQA(qa)}
                          className={`text-xs px-2 py-1 rounded-full font-medium ${qa.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                        >
                          {qa.enabled ? 'ON' : 'OFF'}
                        </button>
                        <button
                          onClick={() => { setEditId(qa.id); setEditQuestion(qa.question || ''); setEditKeywords(qa.keywords); setEditAnswer(qa.answer) }}
                          className="text-xs text-blue-500 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteQA(qa.id)}
                          className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Answer</p>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{qa.answer}</p>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Add new Q&A */}
          <div className="border-t pt-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-600">Add new Q&amp;A</h3>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Question label <span className="text-gray-400 normal-case">(shown as button when multiple matches; falls back to first keyword)</span></label>
              <input
                value={newQuestion}
                onChange={(e) => setNewQuestion(e.target.value)}
                placeholder="e.g. How do I reset my password?"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Keywords (comma-separated)</label>
              <input
                value={newKeywords}
                onChange={(e) => setNewKeywords(e.target.value)}
                placeholder="hello, hi, hey, good morning"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Answer</label>
              <textarea
                value={newAnswer}
                onChange={(e) => setNewAnswer(e.target.value)}
                placeholder="Hello! Welcome to our support chat. How can I help you today?"
                rows={3}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
              />
            </div>
            <button
              onClick={addQA}
              disabled={addingQA || !newKeywords.trim() || !newAnswer.trim()}
              className="bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition"
            >
              {addingQA ? 'Adding…' : '+ Add Q&A'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
