# coturn: our own TURN relay

Live help (talk, see the screen) and the softphone are WebRTC. When the two
sides cannot reach each other directly, the call is relayed through a TURN
server. Admin -> Telephony -> **TURN Relay** chooses one, and it can be
switched at any time:

| choice | what it is |
|---|---|
| None (STUN only) | No relay; some calls cannot connect |
| Own TURN server (coturn) | This folder, on a server of ours |
| Cloudflare TURN | Cloudflare's managed relay, paid by use; see docs/support-desk-setup.md |

## Running it

On any Linux server with Docker (the Coolify host, or a small VPS; not the
CloudPanel host):

1. A DNS name for it, e.g. `turn.saraloms.com` -> the server's public IP. In
   Cloudflare set it to **DNS only** (grey cloud): Cloudflare's proxy does not
   carry UDP.
2. A certificate for that name (`certbot certonly --standalone -d turn.saraloms.com`),
   for TLS on 5349. Optional, but some networks allow nothing else.
3. Open the firewall: `3478/tcp`, `3478/udp`, `5349/tcp`, `5349/udp`,
   `49160-49200/udp`.
4. `cp turnserver.conf.example turnserver.conf`, fill in the public IP, the
   name, a long random password (`openssl rand -hex 24`).
5. `docker compose up -d` (or add this compose file as a resource in Coolify).
6. Admin -> Telephony: TURN Relay **Own TURN server**, TURN Server
   `turn:turn.saraloms.com:3478`, the username and password, then
   **Save & Test TURN**. It asks the server for a relay with those
   credentials, so "gave a relay address" means a call would get one.

Calls are offered the server over UDP, over TCP and over TLS (`turns:` port
5349), so one blocked path still leaves the others.

## When the test says

| message | cause |
|---|---|
| nothing answers on UDP | coturn is not listening on UDP, or the firewall rejects 3478/udp. Calls can still use TCP, more slowly |
| did not answer | a firewall drops the packets; open the ports above |
| refused the username or password | the `user=` line and Telephony disagree |
| refused to relay (403) | a `denied-peer-ip` / allowed rule blocks it |
| relays without asking for a password | `lt-cred-mech` is missing: anyone could use it |
