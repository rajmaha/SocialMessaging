# Support desk setup guide

Last updated 2026-11-03. Editable copy: https://claude.ai/artifact/R5Fv1ro22aMTH7RjUpNKyM

The support desk lets people on an OMS site press Get help, raise a request and follow the replies, while agents answer in SocialMessaging. Set it up once on SocialMessaging and the subscription server, then one click per client site.

This is the setup manual. For adding support to a site that is not OMS (the widget, the identity token, the webhook, the API), see [support-desk.md](support-desk.md).

## How the pieces fit

Requests live in SocialMessaging only; OMS keeps no copy. Each client site is told a widget key and an identity secret, and then talks to SocialMessaging directly.

| System | Its job | What you set there |
| --- | --- | --- |
| SocialMessaging (e.g. workspace.saraloms.com) | Holds every request; agents answer in its Support queue | `SECRET_KEY`, `SUPPORT_SERVICE_KEYS`, agent logins, STUN/TURN for live help |
| Subscription server (OMS) | Sets each client site up with one click | Support desk card: SocialMessaging address, service key, default agents |
| Client OMS site | Shows Get help and the widget to its people | Who may ask (Support menu row), the phone tile |
| Phone app | Support screen for the same people | Nothing on the phone; it asks the client site for a pass |

What **Set up support** on a customer's page does:

1. The subscription server asks SocialMessaging to find or make the client's widget domain, with the default agents and the webhook `https://<client site>/support-hook`.
2. SocialMessaging answers the widget key, its public address, and a new identity secret (only when one was just made).
3. The subscription server passes these to the client site in a signed call, without keeping the secret.
4. The client site stores them. Get help, the widget and the phone screen start working.

## Before you start

- [ ] SocialMessaging runs on `https://` with a real `SECRET_KEY` (see [secret-key-setup.md](secret-key-setup.md)).
- [ ] The subscription server and every client site run the OMS code with the support desk, and Deploy has applied its migration (it adds the Support menu row and the support columns).
- [ ] `$provision_secret` in `db.php` is the same on the subscription server and on every client site. The secret is passed with it; a mismatch makes the client refuse.
- [ ] Each client site has its website address recorded on its customer (lead) on the subscription server, using `https://`.
- [ ] Each client site's `db.php` folder can be written once, or already holds `page_builder_key.php`. The client stores the identity secret encrypted with that key.
- [ ] The people who will answer have SocialMessaging logins.

## Part A: The SocialMessaging server

**1. Set the environment variables** on the backend (deploy panel, then Environment Variables, then Redeploy):

| Variable | Value | Notes |
| --- | --- | --- |
| `SECRET_KEY` | 64 random characters | Must already be set. Signs sign-ins and locks each site's identity secret |
| `SUPPORT_SERVICE_KEYS` | `subscription:<random key>` | One `label:key` pair per subscription server, comma-separated, each key 24+ characters |
| `SUPPORT_PUBLIC_URL` | e.g. `https://workspace.saraloms.com` | Where sites load the widget and support API from. Leave blank when it is the same as `FRONTEND_URL` |

Make the service key the same way as `SECRET_KEY`, and keep a copy for Part B:

```bash
openssl rand -hex 32
```

**2. Agents.** Under Admin, then Users, make sure everyone who will answer has a login. Note their email addresses for Part B.

**3. Live help (talk, see the screen), optional.** Under Admin, then Telephony, fill in the STUN and TURN server, username and credential. Without TURN, calls between some networks will not connect.

**4. Keep the backend on one worker**, as its Dockerfile runs it. Live help passes the call between agent and customer inside one process; two workers would never connect them.

## Part B: The subscription server

On the subscription server, open Subscription, then the **Reminder Emails** tab, and find the **Support desk** card.

| Field | What to put |
| --- | --- |
| SocialMessaging address | Its API address, e.g. `https://workspace.saraloms.com`. `https://` only, the server alone, no path |
| Service key | The key after `subscription:` in `SUPPORT_SERVICE_KEYS` from Part A. Shown as "saved - leave blank to keep" once saved, never again |
| Default agents | Agent emails, comma-separated. They are linked to every new site and get its requests first |

Press Save. The key is stored encrypted and is never shown back.

From now on, a company created through the provisioning API is set up for support automatically. A failure there shows as a warning and an Error Log row, never a failed creation. Companies made on the web screen, and those that existed before, are set up in Part C.

## Part C: Each client site

**1. Connect it (subscription server).** Open Subscription, then Customers, then the customer. In the **Support** box press **Set up support**. The box then shows the outcome:

| The box says | Meaning |
| --- | --- |
| Set up, with a time | The site has its widget key and secret. Done |
| A warning naming agents | Those emails have no SocialMessaging login. Add them there, then press Push again |
| Not pushed, with a reason | SocialMessaging is set up but the client site did not take it. Fix the reason, then Push again |
| `configured: false` | The site never got a secret (its first push failed). Press **Re-key** |

**2. Choose who may ask (client site).** Sign in to the client site as Super Admin. Under Set Up, then Role, tick **view** or **list** on the **Support** menu row for each role that should see Get help. Until then only Super Admin sees it.

**3. Phone app, optional (client site).** On the same Role screen, also tick **Mobile** on the Support row. Then under General Settings, Mobile Menu, add a tile (or bottom tab) with the screen **Support**. Do this only once the app build with the Support screen is on phones; an older build shows "update the app".

Signed-in people now see **Get help** in the user menu, which opens the widget on its Support tab with the page title and address filled in.

## Part D: Tune each site in SocialMessaging

In SocialMessaging, open Admin, then **Widget Domains**, find the client's domain and press **Support**. Set up support has already switched it on; change the rest as needed.

| Setting | Default from Set up support | What it does |
| --- | --- | --- |
| Support requests on | On | Adds the Support tab to the widget |
| Chat tab on | As before | Off = the widget shows Support only |
| Visitors without a site login may ask | Off | On = anybody can ask after confirming an emailed code. Leave off for OMS sites |
| Categories | None | One per line, e.g. Bug, How to, Billing. None = people type their own |
| Organization | The client's name | Requests from this site are filed under it |
| Webhook address | `https://<client site>/support-hook` | Tells the site of replies and status changes, so people get a bell and a push |
| Live help | Off | On = the agent holding a request can ask to talk or see the screen |
| Agents | The default agents | Ticked agents get this site's new requests first |

Do not press **Make secret** here for a site connected through the subscription server: the client would not receive the new secret. Use Re-key on the customer's page instead.

## Setting up a site by hand

Use this only for a site the subscription server does not manage.

1. In SocialMessaging, Admin, Widget Domains: add the site's domain, press **Support**, switch support on, set the webhook to `https://<site>/support-hook`, and press **Make secret**. Copy the secret now; it is shown once. Copy the domain's widget key too.
2. On the OMS site, signed in as Super Admin: General Settings, User Setting, the **Support** card.

| Field | What to put |
| --- | --- |
| Support address | SocialMessaging's address, e.g. `https://workspace.saraloms.com` (`https://` only, no path) |
| Widget key | The widget key from step 1 |
| Identity secret | The secret from step 1. Shown as saved afterwards; blank keeps the saved one |

3. Save, then do steps 2 and 3 of Part C (roles and the phone tile).

## Check it works

Run this once per client site, with a test user who has the Support tick.

- [ ] On the client site, open the user menu and press **Get help**. The widget opens on Support, with the page's title filled in.
- [ ] Raise a test request with a picture attached.
- [ ] In SocialMessaging, the request appears in a ticked agent's **Support queue**. Take it and reply.
- [ ] Back on the client site, the test user gets a bell notice of the reply, and sees it in the widget.
- [ ] Mark the request Solved. The user is told again.
- [ ] Phone app (if set up): open the Support tile, see the same request, and send a reply.
- [ ] Live help (if on): from the ticket, press Ask to see screen. The user accepts within 60 seconds and the agent sees the screen.

If the bell notice never arrives, the webhook is not getting through: see Troubleshooting.

## Later: keeping it running

| When | Do this | What happens |
| --- | --- | --- |
| The client site moved, or its push failed | **Push again** on the customer's page | Sends the address and widget key again; the site keeps its secret |
| The secret may have leaked, or a site lost `page_builder_key.php` | **Re-key** on the customer's page | Makes a new secret and sends it; the old one stops at once |
| SocialMessaging's `SECRET_KEY` changed | **Re-key** every support customer | SocialMessaging can no longer read the old secrets, so every site stops until re-keyed |
| A new agent joins | Tick them under Agents on each domain (Part D), or add them to Default agents for new sites | |
| A subscription server is retired | Remove its pair from `SUPPORT_SERVICE_KEYS` and redeploy | Its key stops working |

Never change `SECRET_KEY` on SocialMessaging without planning the Re-key round straight after.

## Troubleshooting

| What you see | Likely cause | Fix |
| --- | --- | --- |
| Set up support: "could not be reached" | Wrong SocialMessaging address, or it is down | Check the address on the Support desk card (Part B) |
| Set up support: refused, wrong key | The service key does not match `SUPPORT_SERVICE_KEYS` | Paste the key again; check the redeploy took the variable. Ten wrong keys an hour from one address are blocked |
| Set up support: the client answered 404 | The client site runs older OMS code | Deploy the current code to it, then Push again |
| Set up support: the client refused the signature | `$provision_secret` differs between the two `db.php` files | Make them identical, then Push again |
| `configured: false` | The site never received a secret | Re-key |
| No Get help in the user menu | The role lacks the Support tick, or support is not set up | Part C step 2; check the site's User Setting Support card has an address |
| Get help opens a plain page, no widget | The widget script did not load from SocialMessaging | Check `SUPPORT_PUBLIC_URL` and that SocialMessaging is up |
| Replies never reach the client site's bell | The webhook is refused or unreachable | The ticket shows "site not told" with Resend. The site must be `https://` and reachable from SocialMessaging |
| Phone app: Support closes at once | The user lacks the Support tick (403) or support is not set up (503) | Part C steps 2 and 3 |
| Live help: "Could not connect. Try a phone call." | No TURN server, or a network blocks it | Fill in TURN under Admin, Telephony |
