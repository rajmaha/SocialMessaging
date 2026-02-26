# AI Bot Setup & Training Guide

## Part 1 — Get API Keys

### Groq (Recommended to start — fastest free tier)

1. Go to **https://console.groq.com** → Sign up (free)
2. Left menu → **API Keys** → **Create API Key**
3. Copy the key (starts with `gsk_...`)
4. In your admin panel → **Bot Settings** → **AI Provider**:
   - Provider: `Groq`
   - API Key: paste your key
   - Model: `llama-3.1-8b-instant` (fastest) or `mixtral-8x7b-32768` (smarter)

**Free limits:** ~14,000 requests/day

---

### Google Gemini

1. Go to **https://aistudio.google.com** → Sign in with Google
2. Click **Get API Key** → **Create API key in new project**
3. Copy the key (starts with `AIza...`)
4. In admin panel:
   - Provider: `Google Gemini`
   - API Key: paste your key
   - Model: `gemini-1.5-flash` (free, fast) or `gemini-1.5-pro` (smarter, limited free)

**Free limits:** ~1,500 requests/day

---

### Ollama (Local / Self-hosted, No API key needed)

```bash
# macOS install
brew install ollama

# Start Ollama service
ollama serve

# Download a model (choose one):
ollama pull mistral        # 4GB RAM — good balance of speed & quality
ollama pull phi3           # 2GB RAM — small and fast
ollama pull llama3.1       # 5GB RAM — best quality
```

In admin panel:
- Provider: `Ollama`
- Ollama URL: `http://localhost:11434`  (or your server IP if hosted remotely)
- Model: `mistral` (or whichever you pulled)

**Cost:** Free — runs on your own machine/server

---

## Part 2 — Training with Your Industry Information

> There is **no separate training step**. These are already-trained language models.
> You teach them your business context through two methods below.

---

### Method A — System Prompt (Personality + Rules)

In admin panel → **AI Provider** → **System prompt**

This text is injected at the start of every conversation. Write it like instructions to a new customer support employee.

**Template:**
```
You are a customer support assistant for [Company Name].
- We specialise in: [your industry / services]
- Office hours: [days and times] ([timezone])
- Contact: [phone/email]
- [Key policy 1]
- [Key policy 2]
- If you don't know something specific to our company, say "Let me connect you with our team"
- Be [formal/friendly/casual] in tone
```

**Example — Law Firm:**
```
You are a customer support assistant for Johnson & Associates Law Firm.
- We specialise in: family law, property disputes, and corporate contracts
- Office hours: Monday–Friday 9am–6pm (GMT+8)
- Initial consultations are FREE, book at +60-3-1234-5678
- Do NOT give specific legal advice — direct complex queries to our lawyers
- For urgent matters, provide the emergency line: +60-11-9999-0000
- Be professional, empathetic, and concise
- If unsure, say "Let me connect you with one of our lawyers"
```

**Example — E-commerce Shop:**
```
You are a support assistant for StyleHub — an online fashion retailer.
- We ship to Malaysia, Singapore, Thailand
- Shipping: 3–5 business days standard, 1–2 days express (+RM15)
- Returns: accepted within 14 days, items must be unworn with tags
- Sizes run small — recommend customers order one size up
- Payment: credit card, FPX, GrabPay, Touch 'n Go
- Sale items are final — no returns
- Be friendly and use casual but polite language
```

**Example — Property Agency:**
```
You are a support assistant for Nexus Properties.
- We handle residential and commercial property in Klang Valley
- Services: buying, selling, renting, property management
- Listings: visit nexusproperties.com or call +60-3-8888-7777
- Viewing appointments must be booked at least 24 hours in advance
- We do NOT charge buyers any commission — sellers pay 2–3%
- Be professional and helpful; always offer to arrange a viewing
```

---

### Method B — Q&A Pairs (Specific Known Answers)

Go to **Bot Settings** → **Q&A Pairs**

These are fed to the AI automatically as a knowledge base. Even AI providers use them as grounded facts.

**How to write effective Q&As:**

| Field | Guidance |
|---|---|
| **Question label** | How the question appears as a clickable button (e.g. "What are your office hours?") |
| **Keywords** | ALL common ways someone might ask this — include typos and short forms |
| **Answer** | Full, complete answer — write it as if texting a customer |

**Examples — General Business:**

| Question Label | Keywords | Answer |
|---|---|---|
| What are your office hours? | office hours, open, opening time, when, hours | We are open Monday to Friday, 9am–6pm. Saturdays 10am–2pm by appointment. |
| Do you offer refunds? | refund, return, money back, cancel order | Yes! We accept returns within 14 days. Items must be in original condition with tags attached. Contact us at support@company.com to start a return. |
| Where are you located? | location, address, where, find you, directions | We are at Lot 12, Jalan Bukit Bintang, Kuala Lumpur 55100. Near Pavilion KL. |
| How do I track my order? | track, tracking, where is my order, delivery status | Visit our website → My Orders → click your order number. You will also receive a tracking link by email once shipped. |

**Examples — Healthcare Clinic:**

| Question Label | Keywords | Answer |
|---|---|---|
| How do I book an appointment? | appointment, book, schedule, see doctor, consult | Call us at +60-3-5555-1234 or WhatsApp the same number. Online booking is at clinic.com/book. Same-day slots are available before 11am. |
| Do you accept walk-ins? | walk in, no appointment, without appointment | Yes, walk-ins are welcome from 9am–5pm on weekdays. After 5pm by appointment only. Wait time is usually 20–40 minutes. |
| What insurance do you accept? | insurance, panel, coverage, claims | We are a panel clinic for Great Eastern, AIA, Prudential, Etiqa, and Allianz. Please bring your insurance card. |

---

## Part 3 — How the Bot Decides to Reply

```
Visitor sends a message
        │
        ▼
┌─────────────────────────┐
│  Keyword scoring        │  Fast, free, works offline
│  (checks Q&A pairs)     │
└─────────┬───────────────┘
          │
     Match found?
    ╱             ╲
  YES               NO
   │                 │
   ▼                 ▼
Reply from      ┌──────────────────┐
Q&A pair        │  AI Provider     │  Uses your system prompt
(instant)       │  Groq / Gemini   │  + all Q&A pairs as context
                │  / Ollama        │
                └────────┬─────────┘
                         │
                    AI replied?
                   ╱          ╲
                 YES            NO
                  │              │
                  ▼              ▼
             AI answer      Human agent
             sent to         handoff
             visitor         message
```

---

## Part 4 — What Goes Where

| Put in **System Prompt** | Put in **Q&A Pairs** |
|---|---|
| Company name & industry | Specific prices and fees |
| Tone and language style | Office hours and location |
| Topics to avoid | Shipping and return policies |
| Escalation rules | Step-by-step instructions |
| Brand personality | Product-specific FAQs |
| What NOT to promise | Contact details per department |

---

## Part 5 — Testing Your Bot

After saving settings, open the chat widget and test:

| Test | Expected result |
|---|---|
| Exact keyword | Instant reply from Q&A (no AI called) |
| Paraphrased question | AI replies using knowledge base |
| Completely off-topic | Handoff message after N attempts |
| Typo in question | Keyword scorer still matches (partial overlap) |

**Check backend logs to debug:**
```bash
tail -f /tmp/backend.log
```
- AI errors appear as `WARNING` lines
- Successful AI calls complete silently

---

## Part 6 — Recommended Quick Start

1. **Enable bot** in Bot Settings → General
2. **Set welcome message** — e.g. "👋 Hi! I'm [BotName]. How can I help you today?"
3. **Set handoff message** — e.g. "Let me connect you with our team. Someone will reply shortly."
4. **Set handoff after** `3` unmatched messages
5. **Add 10–15 Q&A pairs** for your most common customer questions
6. **Enable Groq** with a free API key + write your system prompt
7. **Test for one week** — note what questions the bot couldn't answer
8. **Add more Q&A pairs** based on real visitor questions
9. Repeat until bot handles 80%+ of queries automatically

---

## Part 7 — Model Recommendations by Use Case

| Use Case | Recommended Model | Provider |
|---|---|---|
| Simple FAQ bot | `llama-3.1-8b-instant` | Groq (free) |
| Complex multi-topic support | `mixtral-8x7b-32768` | Groq (free) |
| Multilingual support | `gemini-1.5-flash` | Gemini (free) |
| Privacy-sensitive industry | `mistral` | Ollama (local) |
| High accuracy required | `llama3.1` | Ollama (local) |
| Budget: zero, speed: max | `phi3` | Ollama (local) |

---

## Part 8 — Privacy & Data Considerations

| Provider | Where data goes | Suitable for |
|---|---|---|
| Groq | US cloud servers | General business, low-sensitivity |
| Gemini | Google cloud | General business |
| Ollama | Your own server | Medical, legal, financial, or any sensitive data |

> **Important:** Visitor messages are sent to the AI provider's servers for processing (except Ollama).
> Do not use cloud providers if visitors share passwords, IC numbers, or medical details.
> For those industries, use **Ollama** on your own server.
