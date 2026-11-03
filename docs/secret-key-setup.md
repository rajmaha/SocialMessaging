# SocialMessaging SECRET_KEY setup

Last updated 2026-11-03. Editable copy: https://claude.ai/artifact/VG6E3jZHsp1aTxZEBa3xD5

Every SocialMessaging server needs its own long random `SECRET_KEY` before the `fix/auth-hardening` branch is merged. Without one, nobody can sign in.

## What the key does

The key is a private value that only the SocialMessaging backend knows. With it, the backend signs things that people must not be able to forge, and locks stored secrets. Changing the key makes everything signed or locked with the old one stop working.

| Used for | What happens if the key changes |
| --- | --- |
| Agent and admin sign-ins (30-day tokens) | Every agent signs in again once |
| Support-desk identity secret of each widget domain | Each support site's Get help and webhooks stop until it is re-keyed (Step 4) |
| Campaign unsubscribe links already emailed | Those links stop working |
| Backup download links, Google Drive connect, webchat OTP codes, support file links | Links still open fail; new ones work |

Rules:

- One key per server. Never share it between servers, or with OMS.
- Never put it in git, a chat, or a ticket.
- Never use the stand-in values `your-secret-key-change-in-production`, `your_secret_key_here` or `change-me-in-production`. They are published in the code, so anyone could forge a sign-in with them.

## Step 1: Check the key the live server has now

If the live server already has a long random key, keep it and skip to Step 4. Replacing a good key only costs a sign-out and a re-key of every support site.

Check one of these:

1. **Deploy panel:** open the SocialMessaging backend app, then its Environment Variables, and look for `SECRET_KEY`.
2. **On the server:** ask the running backend container, replacing the container name with yours:

```bash
docker exec <backend-container> printenv SECRET_KEY
```

| What you see | What to do |
| --- | --- |
| A long random value (32+ characters) | Keep it. Go to Step 4 |
| Empty, or one of the three stand-in values | Make a new key (Step 2) |
| Something short or guessable (a word, a name) | Make a new key (Step 2) |

## Step 2: Make a new key

Run this on your Mac or on the server. It prints 64 random characters:

```bash
openssl rand -hex 32
```

If `openssl` is missing, this does the same:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Copy the value straight into Step 3. Make a separate key for each server, including your Mac.

## Step 3: Put the key in place

Use the row that matches how the server runs. The name is always `SECRET_KEY`, in capitals, with no quotes around the value.

| Where it runs | Where the key goes | Then |
| --- | --- | --- |
| Live server, deployed from the deploy panel | SocialMessaging app, then Environment Variables. Add `SECRET_KEY` with the value | Save, then Redeploy |
| A server running `docker-compose.yml` by hand | The `.env` file in the same folder as `docker-compose.yml`. Add the line `SECRET_KEY=<the value>` | `docker compose up -d` |
| Your Mac (`./start.sh` or uvicorn) | `SocialMessaging/backend/.env`. Add or replace the line `SECRET_KEY=<the value>` | Restart the backend |

**Do this before merging `fix/auth-hardening` to `production`.** That branch refuses every sign-in while the key is missing. `production` deploys itself on every push.

Docker Compose falls back to `change-me-in-production` when no key is given. The `fix/auth-hardening` branch refuses that value, so a compose server with no key cannot sign anyone in. Always set the key explicitly.

## Step 4: Check it works

- [ ] Confirm the backend sees the key: `docker exec <backend-container> printenv SECRET_KEY` prints your value.
- [ ] Sign in to SocialMessaging with your email and the emailed code. It must not say "SECRET_KEY is not set".
- [ ] Open the inbox and an admin page. Both load without sending you back to the login page.
- [ ] Tell agents they will be asked to sign in again once. This is expected after the merge.
- [ ] **Only if the key changed and support sites were already set up:** on the subscription server, open each support customer's page, then use Re-key in the Support box. This makes a new identity secret and sends it to the client site. Until then, that site's Get help and support replies stop working.

## OMS: nothing to add

OMS never needs SocialMessaging's `SECRET_KEY`, and must not be given it. OMS talks to SocialMessaging with keys of its own:

| Link between the two | Key it uses |
| --- | --- |
| Support widget and the phone app's support screen | The support widget key and support secret, set by Set up support on the subscription server |
| Subscription server setting up a client's support | A key from SocialMessaging's `SUPPORT_SERVICE_KEYS` |
| SocialMessaging creating companies in OMS | OMS's `$provision_secret` in each site's `db.php` |

The one OMS effect is in Step 4: if the SocialMessaging key changes, re-key each support site from the subscription server.

## Troubleshooting

| What you see | Cause | Fix |
| --- | --- | --- |
| Sign-in says "SECRET_KEY is not set" | No key, or a stand-in value | Steps 2 and 3, then redeploy |
| Everyone is sent to the login page with "Your session has ended" | The key changed, or the branch was just merged | Expected once. Sign in again |
| Sent to login again after every redeploy | The key changes on each deploy (it is not saved in the panel) | Save it as a panel Environment Variable, not in a one-off command |
| Get help on an OMS site stops working | The key changed, so the stored support secret no longer opens | Re-key that customer from the subscription server (Step 4) |
| An old campaign unsubscribe link fails | It was signed with the old key | Nothing to fix. New emails carry working links |
