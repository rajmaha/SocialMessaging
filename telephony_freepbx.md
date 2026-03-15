# Telephony (VoIP) Module: FreePBX Integration Guide

This guide explains how to integrate your existing **Telephony (VoIP)** module with a FreePBX server. Your application requires specific settings in FreePBX to establish bidirectional communication for managing extensions, initiating calls (AMI), handling WebRTC in the browser, and receiving Call Detail Records (CDR).

## Prerequisites
1. A running instance of FreePBX 15 or higher.
2. The IP address or domain name of your FreePBX server.

---

## Step 1: Enable the FreePBX REST API (For Extension Sync)
Your application's backend automatically creates, updates, and deletes FreePBX extensions directly from the UI using the FreePBX REST API (`/api/rest/extension`).

1. Log into your **FreePBX Admin Interface**.
2. If using FreePBX 17, go to **Settings -> API** (or **Applications -> API**).
   *(Note: If you don't see this menu, go to **Admin -> Module Admin**, search for the "API" module, and install it).*
3. In the API module, create a new **Application** under the OAuth or Apps tab.
4. Select the required scopes (e.g., `rest` or specific extension read/write scopes) for this application.
5. Save the application, and the system will generate a **Client ID** and a **Client Secret**. Copy these immediately as they may not be shown again.
5. In your application's Telephony Settings page, enter:
   * **PBX Type:** `freepbx`
   * **Host:** Your FreePBX IP or Domain (e.g., `pbx.yourdomain.com`)
   * **FreePBX API Key:** The Client ID from above.
   * **FreePBX API Secret:** The Client Secret from above.

---

## Step 2: Enable Asterisk Manager Interface (AMI) (For Click-to-Call)
Your backend uses AMI (via the `panoramisk` library in `ami_service.py`) to initiate calls for agents (Click-to-Call).

1. In FreePBX, navigate to **Settings -> Asterisk Manager Users**.
2. Click **Add Manager**.
3. Configure the settings:
   * **Manager Name**: e.g., `app_ami_user`
   * **Manager Secret**: Choose a strong, secure password.
   * **Deny**: `0.0.0.0/0.0.0.0`
   * **Permit**: `127.0.0.1/255.255.255.0` AND the external IP address of your application server (e.g., `192.168.1.50/255.255.255.0`).
   * **Read / Write Permissions**: Check `system, call, log, verbose, command, agent, user, config`, or simply check **All**.
4. Click **Submit** and **Apply Config**.
5. In your application's Telephony Settings page, enter:
   * **AMI Username:** `app_ami_user`
   * **AMI Secret:** The secret you just created.
   * **Port:** `5038` (default).

---

## Step 3: Enable WebRTC (For Browser Calling)
Your module supports making and receiving calls directly in the browser via WebRTC.

1. In FreePBX, go to **Settings -> Advanced Settings**.
   * Turn on **Enable WebRTC Phone**.
   * Turn on **Enable SIP WebSocket**.
   * Take note of the WebSocket ports (typically `8088` for ws:// and `8089` for wss://).
   * Click **Save** and **Apply Config**.
2. *Note: Extension configuration is handled automatically by the REST API sync in your app, which sets the `type` to `pjsip`.*
3. In your application's Telephony Settings page, enter the WebRTC WSS URL:
   * **WebRTC WSS URL:** `wss://<freepbx_domain>:8089/ws` (Must use `wss://` if your frontend is served over HTTPS).

---

## Step 4: Configure Call Detail Records (CDR) Webhooks
To keep call history synchronized, FreePBX needs to ping your application when a call finishes.
*(Since your custom application has a `freepbx_cdr_service.py`, you need to direct FreePBX to post to your `/api/telephony/cdr` or equivalent webhook endpoint).*

1. If you have the commercial FreePBX **Webhooks** module, configure it to send a POST request to your application's public URL/webhook path on the `Hangup` event.
2. If relying on custom dialplan, edit `/etc/asterisk/extensions_custom.conf` on the FreePBX server:

```ini
[macro-hangupcall-custom]
exten => s,1,NoOp(Sending CDR to SocialMedia App)
exten => s,n,Set(CURL_RESULT=${CURL(http://<YOUR_APP_IP>/api/.../cdr,caller=${CALLERID(num)}&duration=${CDR(billsec)}&status=${CDR(disposition)})})
exten => s,n,Return()
```
3. Run `asterisk -rx "dialplan reload"` on the server.

---

## Summary of Application Settings to Fill Out
Go to your application's **Admin -> Telephony (VoIP)** page and enter the values you just gathered:

* **PBX Host / IP:** `<Your FreePBX Server IP/URL>`
* **PBX Port (AMI):** `5038`
* **AMI Username:** `<AMI Manager Name>`
* **AMI Secret:** `<AMI Manager Secret>`
* **WebRTC WSS URL:** `wss://<FreePBX Server IP>:8089/ws`
* **FreePBX API Key:** `<REST API Client ID>`
* **FreePBX API Secret:** `<REST API Client Secret>`
* Toggle **Active** to ON and save.
