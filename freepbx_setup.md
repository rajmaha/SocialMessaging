# FreePBX Setup Guide

Here is a comprehensive guide to setting up **FreePBX**, the most popular open-source graphical user interface for the Asterisk PBX system. 

The easiest and universally recommended way to install FreePBX is by using the **FreePBX Distro**, which bundles the Linux OS, Asterisk, FreePBX GUI, and all necessary dependencies into one ISO installer.

---

### Phase 1: Installation (FreePBX Distro)
This method assumes you are installing FreePBX on a dedicated physical machine, a virtual machine (VMware/Proxmox/VirtualBox), or a custom VPS that allows ISO mounting.

**1. Download the ISO**
* Go to the official [FreePBX Download Page](https://www.freepbx.org/downloads/).
* Download the current stable **FreePBX Distro ISO** (usually based on Sangoma OS / Linux).

**2. Create Bootable Media**
* If installing on physical hardware, use a tool like **Rufus** (Windows) or **BalenaEtcher** (Mac/Windows/Linux) to securely flash the ISO to a USB drive.
* If using a VM, simply attach the downloaded `.iso` file to the virtual CD/DVD drive and boot the VM.

**3. Run the Installer**
* Boot from the ISO.
* Choose **FreePBX Standard** (usually the recommended graphical installation).
* Select your display settings (VGA/Serial) and standard installation.
* The system will prompt you to configure:
  * **Root Password**: Choose a strong password for SSH/Linux root access.
  * **Network**: Set up a static IP address (highly recommended for a PBX) or leave it as DHCP for now. 
  * **Timezone**: Set your local timezone so logs and call records match your day.
* Wait for the installation to finish and the system to reboot. (Remember to remove the USB/ISO before it boots again).

---

### Phase 2: Initial Web Configuration

Once the system reboots, the console will display the server's IP address. Switch to a computer on the same network.

**1. Access the Web GUI**
* Open your web browser and navigate to `http://<your-pbx-ip-address>`.

**2. Create the Admin Account**
* On the first visit, you will be prompted to create the primary administrator account.
* Enter a Username, Password, and an Admin Email address. 
* Click **Setup System**.

**3. System Activation**
* Log in with your new admin credentials.
* FreePBX will ask you to activate your system. This is free but requires a Sangoma/FreePBX Portal account. 
* Activation is required to purchase commercial modules later and to enable the System Firewall. Just follow the prompt to create an account and link your deployment.

**4. Firewall Setup (Crucial)**
* Immediately navigate to **Connectivity -> Firewall**.
* Enable the firewall. 
* Add your current IP address and your local subnet (e.g., `192.168.1.0/24`) to the **Trusted/Local** zone. This prevents you from being locked out while blocking external SIP scanners.

**5. Update Modules**
* Go to **Admin -> Module Admin**.
* Click **Check Online**, then choose **Upgrade All**.
* Click **Process** and confirm. This ensures all parts of your GUI are secure and up-to-date. Click **Apply Config** (the big red button at the top right) when done.

---

### Phase 3: Basic PBX Setup

Now your server is running. Next, you need to set up phones (Extensions) and a way to call the outside world (Trunks).

#### 1. Create Extensions (Internal Phones)
Extensions are the individual phones or softphones in your office.
* Go to **Applications -> Extensions**.
* Click **Add Extension** -> **Add New PJSIP Extension**.
* Fill in the basics:
  * **User Extension**: e.g., `101`
  * **Display Name**: e.g., `Alice Smith`
  * **Outbound CID**: (Optional) specific phone number to show when Alice calls someone.
  * **Secret**: The password for this extension (FreePBX generates a strong one automatically. Copy this, you'll need it for the phone).
* Click **Submit** and then **Apply Config**.
* *You can now use a softphone app (like Zoiper, MicroSIP, or Linphone) on your computer/phone to connect using the IP address, Extension `101`, and the Secret.*

#### 2. Configure a SIP Trunk (External Lines)
A SIP trunk connects your FreePBX to a telecom provider (like Twilio, Flowroute, VoIP.ms) so you can make outside calls.
* Go to **Connectivity -> Trunks**.
* Click **Add Trunk** -> **Add SIP (chan_pjsip) Trunk**.
* **General Tab**:
  * **Trunk Name**: e.g., `MyVoipProvider`
* **pjsip Settings -> General Tab**:
  * **Authentication**: Usually `Outbound`
  * **Registration**: Usually `Send`
  * **SIP Server**: Ask your provider (e.g., `sip.provider.com`)
  * **Username / Password**: The trunk credentials given by your VoIP provider.
* Click **Submit** and **Apply Config**.

#### 3. Set Up Outbound Routes (Making Calls)
Tell FreePBX which trunk to use when someone dials an outside number.
* Go to **Connectivity -> Outbound Routes**.
* Click **Add Outbound Route**.
* **Route Settings Tab**:
  * **Route Name**: e.g., `Standard_Out`
  * **Trunk Sequence for Matched Routes**: Select the trunk you created in step 2.
* **Dial Patterns Tab**:
  * Enter standard dial patterns. Usually, you can use the "Dial Pattern Wizards" or specify common rules:
    * `NXXNXXXXXX` (Standard US 10-digit number)
    * `1NXXNXXXXXX` (Standard US 11-digit number)
* Click **Submit** and **Apply Config**.

#### 4. Set Up Inbound Routes (Receiving Calls)
Tell FreePBX where to route incoming calls based on the phone number dialed (DID).
* Go to **Connectivity -> Inbound Routes**.
* Click **Add Inbound Route**.
* **General Tab**:
  * **Description**: e.g., `Main Company Line`
  * **DID Number**: Put the phone number you bought from your provider here (e.g., `18005551234`). Leave blank to catch *all* incoming calls not tied to another route.
  * **Set Destination**: Choose where the call should ring. Choose **Extension** -> and pick the extension you created (e.g., `101 Alice Smith`). 
* Click **Submit** and **Apply Config**.

---

### Next Steps for a complete system:
Once you have internal calling and external calling working, you can expand your FreePBX with:
1. **Ring Groups**: (Applications -> Ring Groups) Make multiple extensions ring at the same time.
2. **IVR (Interactive Voice Response)**: (Applications -> IVR) Setup an "auto attendant" ("Press 1 for Sales, 2 for Support"). *Note: You will need to record a greeting via System Recordings first.*
3. **Voicemail to Email**: (Admin -> System Admin -> Email Setup) Configure SMTP so voicemails are emailed as `.wav` attachments to users.

---
---

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
