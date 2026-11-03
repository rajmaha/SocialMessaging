# Support desk: putting it on a website

The support desk lets people on a website raise a support request, follow it
and reply, from the same widget that carries the live chat. Requests land in
the workspace's **Support queue**, where an agent takes one, replies, and marks
it solved. The customer is emailed at each step, and the site can be told by a
signed webhook.

This guide is for whoever adds support to a site. Admin set-up is on
**Admin -> Widget Domains -> Support**.

Setting the whole system up (SocialMessaging, the subscription server, each
OMS site, the phone app) is [support-desk-setup.md](support-desk-setup.md).

## 1. Switch it on for the domain

On **Admin -> Widget Domains**, find (or add) the site's domain, press
**Support**, and set:

| setting | what it does |
|---|---|
| Support requests on | adds a **Support** tab to the widget |
| Chat tab on | off = the widget shows Support only |
| Visitors without a site login may ask | on = anonymous visitors verify an email with a code; off = only people the site signs in |
| Categories | one per line; none = the customer types their own |
| Organization | requests from this site are filed under it |
| Webhook address | optional; told of every reply and status change (section 4) |
| Live help | on = the agent holding a request can ask to talk to the person or see their screen (section 7) |
| Identity secret | **Make secret**, shown once. Needed to sign in the site's own users and to check webhooks |

Tick the agents who handle this site under **Agents**: new requests reach them
first, in their Support queue.

## 2. Put the widget on the page

The same two lines as the chat widget:

```html
<script>
  window.SocialChatConfig = { serverUrl: 'https://workspace.saraloms.com' };
</script>
<script src="https://workspace.saraloms.com/chat-widget.js" data-key="<widget key>" async></script>
```

With anonymous visitors allowed, that is all. For a site with its own logins,
add the signed-in person's identity (section 3):

```html
<script>
  window.SocialChatConfig = {
    serverUrl: 'https://workspace.saraloms.com',
    identity: '<token made by your server for this person>',
    identityUrl: '/support/identity'   // your own URL answering {"token": "..."} with a fresh one
  };
</script>
<script src="https://workspace.saraloms.com/chat-widget.js" data-key="<widget key>" async></script>
```

- Print `identity` only for a signed-in person; leave it out for anyone else.
- The token lives 10 minutes. When it runs out the widget calls `identityUrl`
  (same origin, with the page's cookies) and expects `{"token": "..."}` for the
  signed-in person, so a page left open all day keeps working. Answer 401 for
  anyone not signed in.
- A **Help** link can open Support with the screen filled in:

```html
<a href="#" onclick="SocialChat.open('support', {screen: 'Payroll -> Salary sheet'}); return false">Get help</a>
```

`SocialChat.open('chat')` opens the chat; `SocialChat.close()` closes the widget.

## 3. The identity token

Made on the site's **server** with the domain's identity secret. Never make it
in the browser, and never put the secret in a page.

```
payload = base64url(JSON)            -- URL-safe alphabet, no "=" padding
token   = payload + "." + hex( HMAC-SHA256(secret, payload) )
```

The JSON:

| key | value |
|---|---|
| `site` | the domain's widget key |
| `uid` | the person's id on your site, stable (e.g. `"oms.example.com:42"`), up to 200 characters |
| `name`, `email`, `phone` | optional; shown to agents and used to email replies |
| `exp` | expiry, Unix seconds, **at most 10 minutes ahead** |

The signature is over the base64 text exactly as sent, so key order and spacing
in the JSON do not matter. A token is refused when the signature is wrong, it
has expired, `exp` is further than 10 minutes ahead (a minute of clock
difference is allowed either way), `site` is another domain's key, or `uid` is
missing. A person only ever sees their own requests on that domain.

### PHP

```php
function support_token(string $secret, string $widgetKey, string $uid, array $person = []): string
{
    $claims = ['site' => $widgetKey, 'uid' => $uid, 'exp' => time() + 600] + $person;  // name, email, phone
    $payload = rtrim(strtr(base64_encode(json_encode($claims, JSON_UNESCAPED_UNICODE)), '+/', '-_'), '=');
    return $payload . '.' . hash_hmac('sha256', $payload, $secret);
}
```

### Node.js

```js
const crypto = require('crypto')

function supportToken(secret, widgetKey, uid, person = {}) {
  const claims = { site: widgetKey, uid, exp: Math.floor(Date.now() / 1000) + 600, ...person }
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('hex')
}
```

### Check your implementation

With the secret `test-identity-secret` and exactly this JSON (no spaces):

```
{"site":"wk-test-1","uid":"oms.example.com:42","name":"Ram Sharma","email":"ram@example.com","phone":"9800000000","exp":1900000000}
```

the token must be:

```
eyJzaXRlIjoid2stdGVzdC0xIiwidWlkIjoib21zLmV4YW1wbGUuY29tOjQyIiwibmFtZSI6IlJhbSBTaGFybWEiLCJlbWFpbCI6InJhbUBleGFtcGxlLmNvbSIsInBob25lIjoiOTgwMDAwMDAwMCIsImV4cCI6MTkwMDAwMDAwMH0.fdce23691e6436cc7f02964d240ac08c9c3ed66041cd442ad94dc21b19c28ba2
```

## 4. The webhook

With a webhook address set, SocialMessaging POSTs to it when an agent replies,
when the status changes, and when a request is raised:

```
POST <webhook address>
Content-Type: application/json
X-Support-Event: reply                      request_created | reply | status | live_request | live_ended
X-Support-Event-Id: 6f1c...                 the same on every retry of this event
X-Support-Signature: sha256=<hex HMAC-SHA256 of the raw body, keyed with the identity secret>

{"event_id": "6f1c...", "event": "reply", "ticket_no": "SUP-20261102-6EA6EF1C",
 "uid": "oms.example.com:42", "email": null, "subject": "Payslip PDF shows wrong month",
 "status": "replied",
 "message": {"author_type": "agent", "author": "Ram (Support)", "body": "Fixed now.", "at": "2026-11-02T08:42:50+00:00"},
 "sent_at": "2026-11-02T08:42:51Z"}
```

- `uid` is the signed person's id; `email` is set instead for an anonymous visitor.
- `live_request` and `live_ended` carry `"live": {"id", "kind": "talk"|"screen",
  "status", "agent", "expires_at", "ended_at"}` and no `message`. Tell the person
  on `live_request`, by a push to their phone, for instance: the widget shows the
  request only while it is open on a page. `live_ended` is for the record.
- `status` is `waiting`, `replied` or `solved`, as the customer sees it.
- Check the signature over the **raw body**, before parsing it, and compare in
  constant time. Ignore an `event_id` already handled: a retry repeats it.
- Answer 2xx once it is handled. Anything else is tried again after 1, 5, 15
  and 60 minutes and 6 hours, then shown to the agent as "site not told" with a
  **Resend** button.
- The address must be `https://` and must not point at a private network.
  Redirects are not followed.

### PHP

```php
$raw = file_get_contents('php://input');
$expected = 'sha256=' . hash_hmac('sha256', $raw, $secret);
if (!hash_equals($expected, $_SERVER['HTTP_X_SUPPORT_SIGNATURE'] ?? '')) {
    http_response_code(401);
    exit;
}
$event = json_decode($raw, true);
// ... skip if $event['event_id'] was handled before, then act on it
http_response_code(200);
```

### Node.js (Express)

```js
app.post('/support-hook', express.raw({ type: 'application/json' }), (req, res) => {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.body).digest('hex')
  const given = req.get('X-Support-Signature') || ''
  const ok = given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  if (!ok) return res.sendStatus(401)
  const event = JSON.parse(req.body)
  // ... skip if event.event_id was handled before, then act on it
  res.sendStatus(200)
})
```

## 5. The API, for apps and a site's own screens

The widget uses this API; a phone app or a site's own pages can too. Base
`https://workspace.saraloms.com/api/support/v1`. Every call sends
`X-Support-Key: <widget key>`, and a call about a person also sends
`Authorization: Support <identity token>` (or, for an anonymous visitor,
`X-Webchat-Session: <session id>` from the webchat email code).

| call | does |
|---|---|
| `GET config` | site name, colour, categories, priorities, limits |
| `GET me` | who the call is from |
| `POST requests` | multipart: `subject`, `body`, `category`, `priority` (low/normal/high/urgent), `phone`, `screen`, `url`, `request_id`, `files` (up to 5 of 10 MB: pictures, PDF, Word, Excel, CSV, text) |
| `GET requests?page=` | the person's own requests, 20 a page |
| `GET requests/{no}` | one of them, with its thread |
| `GET requests/{no}/changes?after=<message id>` | new messages and the status, for a thread that is open |
| `POST requests/{no}/messages` | multipart: `body`, `request_id`, `files`; replying within 7 days of Solved reopens it |
| `GET files/{message id}/{index}` | an attachment; the links in an answer work for an hour without headers |
| `GET live` | `{"live": ...}`: an agent's request to talk or see the screen, waiting for this person's answer (any of their requests), or null |
| `POST live/{id}/accept` | JSON `{"screen_ok": true|false}` (whether this device can share its screen); answers a one-time `pass`, `ice_servers`, `ws_path` |
| `POST live/{id}/deny` | says no |
| `WS live/ws?pass=<pass>` | the call's signalling (section 7) |

`requests/{no}` and `changes` also carry `live` while one of that request's is waiting.

`request_id` (8-64 letters, digits, `-` or `_`, new for each press) makes a
double press one request or message. A refusal answers JSON `{"detail": "<a
sentence for the person>"}` with 401 (who), 403 (support off), 404 (not
theirs), 409, 422 or 429. Limits: 10 requests an hour per person and 30 per
address, 60 messages an hour per person.

## 6. Setting sites up from a subscription server

A subscription server that provisions client sites can set up their support
itself, with a key from `SUPPORT_SERVICE_KEYS` in SocialMessaging's `.env`
(`label:key` pairs, at least 24 characters each, one per server):

```
POST /api/support/v1/admin/domains
X-Support-Service-Key: <key>

{"domain": "client.saraloms.com", "display_name": "Client Ltd",
 "organization_name": "Client Ltd", "agent_emails": ["ram@..."],
 "categories": ["Bug", "How to"], "webhook_url": "https://client.saraloms.com/support-hook",
 "rotate": false}
```

It finds or makes the widget domain (support on; anonymous visitors off for a
new one), links the agents it finds by email (`agents_not_found` names the
rest), finds or makes the organization, and makes an identity secret when the
domain has none or `rotate` is true. The answer carries `widget_key`,
`server_url`, and `secret` **only when one was just made**: pass it straight
to the client site and do not keep it. Calling it again changes nothing that
was not asked for. `GET /api/support/v1/admin/domains?domain=...` reports the
set-up without the secret. Every call is in the audit log under the key's
label; ten wrong keys an hour from one address are refused.

## 7. Live help: talking, and seeing the screen

With **Live help** on for the domain, the agent holding a request has a **Live
help** card on the ticket: **Call phone** (the softphone; the call's record is
stamped with the ticket number), **Ask to talk**, **Ask to see screen**.

- Only the agent holding the request can ask; three asks per request in ten
  minutes; one live session per request at a time.
- The person has **60 seconds** to accept or say no. The widget asks every 15
  seconds while it is on a page, opens on Support by itself and shows the
  request; the site's webhook hears `live_request` so it can tell them
  elsewhere (an app push).
- **Accept** answers a one-time pass, good for **2 minutes** and for one
  connection. In a browser the widget opens a small window
  (`/widget/live`) for the call, so it survives the site's own page loads.
- The call is WebRTC, peer to peer, through the STUN / TURN servers set under
  Telephony; the server only passes the signalling along. **Nothing is
  recorded.** The agent watches; they never control anything.
- Not connected within 20 seconds of both being in: both sides read "Could not
  connect. Try a phone call." An accepted pass never used counts as failed.
- When it ends, the thread gets a line ("Screen shared 14:02-14:15 with Ram",
  "Talked ...", or "could not connect") and the webhook hears `live_ended`.

An app does the person's side itself:

1. `POST live/{id}/accept` with `screen_ok` false where it cannot share (an
   iPhone app without a broadcast extension): the agent is told it is a voice
   call.
2. Open `WS <server>/api/support/v1/live/ws?pass=<pass>`. The server says
   `{"type": "hello", "ice_servers": [...], "live": {...}, "screen_ok": ...}`,
   then `{"type": "ready"}` once the agent is in too.
3. On `ready` the person's side **offers**: send `{"type": "offer", "sdp":
   ...}`, take `{"type": "answer", "sdp": ...}`, and trade `{"type": "ice",
   "candidate": {...}}` both ways.
4. `{"type": "bye"}` ends it; `{"type": "failed", "reason": "..."}` reports a
   failure; `{"type": "state", "muted": true}` / `{"sharing": false}` are
   passed on to the agent. Send `{"type": "ping"}` every 25 seconds to keep
   the socket open. A pass that has been used, or has lapsed, is closed with
   code 4401.
