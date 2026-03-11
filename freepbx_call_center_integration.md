# FreePBX API & Call-Center Integration Guide

To integrate FreePBX with your custom Voip / Call-Center module (like a CRM or browser-based dialer), you need programs to communicate bidirectionally with the Asterisk core that powers FreePBX.

There are three primary methods to integrate your Call Center backend (e.g., Python/FastAPI or Node.js) with FreePBX:
1. **AMI (Asterisk Manager Interface)**: Best for subscribing to live call events (ringing, answered, hung up) and simple actions like Click-to-Call.
2. **ARI (Asterisk REST Interface)**: Best for advanced custom telephony apps where your backend controls the exact flow of the media and call.
3. **Webhooks / AGI**: Best for triggering external HTTP requests when specific PBX dialplan events occur.

---

## Method 1: Connecting via AMI (Asterisk Manager Interface)
AMI is a TCP socket-based protocol. It allows your backend to log in and receive a constant stream of events, as well as issue commands like "Originate" to start a call.

### 1. Enable AMI in FreePBX
1. Log into your FreePBX Admin Interface.
2. Go to **Settings -> Asterisk Manager Users**.
3. Click **Add Manager**.
4. Configure the settings:
   * **Manager Name**: e.g., `crm_backend`
   * **Manager Secret**: e.g., `SuperSecretToken123`
   * **Deny**: `0.0.0.0/0.0.0.0`
   * **Permit**: `127.0.0.1/255.255.255.0` (Add your backend server's IP if it is external, e.g., `192.168.1.50/255.255.255.0`)
   * **Read Permissions**: Select All (or at least `system, call, log, verbose, command, agent, user, config`)
   * **Write Permissions**: Select All (or at least `system, call, log, verbose, command, agent, user, config`)
5. Click **Submit** and **Apply Config**.

### 2. Connect Your Backend (Python Example)
If your backend is in Python (FastAPI/Asyncio), you can use the `panoramisk` library to connect to AMI asynchronously.

1. Install the library:
   ```bash
   pip install panoramisk
   ```

2. Listen to Live Call Events (For Screen Pops & Real-time Dashboards):
   ```python
   import asyncio
   from panoramisk import Manager

   manager = Manager(
       loop=asyncio.get_event_loop(),
       host='<freepbx_ip>',
       port=5038,
       username='crm_backend',
       secret='SuperSecretToken123'
   )

   @manager.register_event('DialBegin')
   async def handle_dial_begin(manager, event):
       print(f"Call ringing! Caller: {event.CallerIDNum} is calling {event.DestCallerIDNum}")
       # Here: Send a WebSocket message to your frontend Call-Center module to trigger a "Screen Pop"

   async def main():
       await manager.connect()
       print("Connected to FreePBX AMI")
       await asyncio.Event().wait()

   if __name__ == '__main__':
       asyncio.run(main())
   ```

### 3. Click-to-Call (Originate)
When a user clicks a phone number in your UI, your backend can ask FreePBX to call their desk phone (or WebRTC softphone) first, and when they pick up, dial the customer.

```python
async def click_to_call(agent_ext: str, customer_number: str):
    action = {
        'Action': 'Originate',
        'Channel': f'PJSIP/{agent_ext}', # Ring the agent first
        'Context': 'from-internal',      # As if the agent dialed it directly
        'Exten': customer_number,        # Number to dial once agent picks up
        'Priority': '1',
        'CallerID': f'CRM <{customer_number}>',
        'Async': 'true'
    }
    await manager.send_action(action)
```

---

## Method 2: Browser-Based Calling (WebRTC / SIP.js)
If your call-center module needs the actual phone audio to be handled *inside the browser* (no physical desk phone needed), you must enable WebRTC in FreePBX and use a frontend library like SIP.js.

### 1. Enable WebRTC in FreePBX
1. Go to **Settings -> Advanced Settings**.
   * Turn on **Enable WebRTC Phone**.
   * Turn on **Enable SIP WebSocket**.
   * Click **Save** and **Apply Config**.
2. Go to **Applications -> Extensions**, and edit an extension.
   * Under the **Advanced** tab, ensure the following are set:
     * **Transport**: `ws` or `wss` (WebSocket Secure is required for HTTPS domains)
     * **Enable AVPF**: `Yes`
     * **Force rport**: `Yes`
     * **WebRTC**: `Yes`
     * **DTLS Enable**: `Yes`

### 2. Frontend Integration (SIP.js / React / Next.js)
In your `frontend` app, install SIP.js:
```bash
npm install sip.js
```
Then initialize a WebRTC User Agent to register directly to FreePBX:
```javascript
import { Web } from "sip.js";

const userAgent = new Web.SimpleUser("wss://<freepbx_ip>:8089/ws", {
    aor: "sip:101@<freepbx_ip>",
    media: {
        remote: { audio: document.getElementById('remoteAudio') }
    }
});

await userAgent.connect();
await userAgent.register({
    authorizationUsername: "101",
    authorizationPassword: "ExtensionSecretPassword"
});

// To make a call:
userAgent.call("sip:18005551234@<freepbx_ip>");
```

---

## Method 3: Call Detail Records (CDR) Webhooks
If you only need a log of complete calls automatically inserted into your call-center database, you can use FreePBX Webhooks to HTTP POST data to your backend after every call.

1. Install the FreePBX "Webhooks" module from Module Admin (if available/commercial), OR use a custom dialplan `[macro-hangupcall-custom]`.
2. To use the custom dialplan approach without buying modules, edit `/etc/asterisk/extensions_custom.conf` via SSH:

```ini
[macro-hangupcall-custom]
exten => s,1,NoOp(Sending CDR to backend)
exten => s,n,Set(CURL_RESULT=${CURL(http://YOUR_BACKEND_IP/api/call-center/cdr,caller=${CALLERID(num)}&duration=${CDR(billsec)}&status=${CDR(disposition)})})
exten => s,n,Return()
```
3. Reload the dialplan: `asterisk -rx "dialplan reload"`

Your backend `/call-center/cdr` route will now receive a GET or POST request containing the exact details of every hung-up call.
