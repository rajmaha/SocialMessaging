/**
 * SocialMedia Live Chat Widget
 * Embed on any website with:
 *   <script src="https://your-domain.com/chat-widget.js"></script>
 *
 * Optional config (set before the script tag):
 *   window.SocialChatConfig = { serverUrl: 'https://your-domain.com' }
 */
;(function () {
  var config = window.SocialChatConfig || {}
  var SERVER = config.serverUrl || window.location.origin
  var WIDGET_URL = SERVER + '/widget'
  var BRANDING_URL = SERVER + '/api/webchat/branding'  // proxied via Next.js if needed

  // Fetch branding to style the launcher button
  var primaryColor = '#2563eb'
  fetch(SERVER.replace(':3000', ':8000') + '/webchat/branding')
    .then(function (r) { return r.json() })
    .then(function (b) {
      if (b.primary_color) {
        primaryColor = b.primary_color
        launcher.style.background = primaryColor
      }
    })
    .catch(function () {})

  // ── Launcher button ────────────────────────────────────────────────────
  var launcher = document.createElement('button')
  launcher.id = 'sc-chat-launcher'
  launcher.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>'
  Object.assign(launcher.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    width: '56px',
    height: '56px',
    borderRadius: '50%',
    background: primaryColor,
    color: '#fff',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 16px rgba(0,0,0,0.22)',
    zIndex: '2147483640',
    transition: 'transform 0.2s, box-shadow 0.2s',
  })
  launcher.addEventListener('mouseenter', function () {
    launcher.style.transform = 'scale(1.08)'
    launcher.style.boxShadow = '0 6px 20px rgba(0,0,0,0.28)'
  })
  launcher.addEventListener('mouseleave', function () {
    launcher.style.transform = 'scale(1)'
    launcher.style.boxShadow = '0 4px 16px rgba(0,0,0,0.22)'
  })

  // Unread badge
  var badge = document.createElement('span')
  badge.id = 'sc-chat-badge'
  Object.assign(badge.style, {
    display: 'none',
    position: 'absolute',
    top: '0',
    right: '0',
    background: '#ef4444',
    color: '#fff',
    borderRadius: '50%',
    width: '18px',
    height: '18px',
    fontSize: '11px',
    fontWeight: 'bold',
    lineHeight: '18px',
    textAlign: 'center',
    border: '2px solid #fff',
  })
  launcher.style.position = 'fixed'
  launcher.appendChild(badge)

  // ── iframe container ───────────────────────────────────────────────────
  var container = document.createElement('div')
  container.id = 'sc-chat-container'
  Object.assign(container.style, {
    position: 'fixed',
    bottom: '90px',
    right: '24px',
    width: '360px',
    height: '560px',
    maxHeight: 'calc(100vh - 110px)',
    borderRadius: '16px',
    overflow: 'hidden',
    boxShadow: '0 8px 40px rgba(0,0,0,0.20)',
    zIndex: '2147483639',
    display: 'none',
    flexDirection: 'column',
    border: '1px solid rgba(0,0,0,0.08)',
    // Animation
    transform: 'translateY(12px)',
    opacity: '0',
    transition: 'transform 0.22s cubic-bezier(.4,0,.2,1), opacity 0.22s ease',
  })

  var iframe = document.createElement('iframe')
  iframe.src = WIDGET_URL
  iframe.title = 'Live Chat'
  Object.assign(iframe.style, {
    width: '100%',
    height: '100%',
    border: 'none',
    borderRadius: '16px',
  })
  container.appendChild(iframe)

  var open = false
  var unread = 0

  function openChat() {
    open = true
    container.style.display = 'flex'
    requestAnimationFrame(function () {
      container.style.transform = 'translateY(0)'
      container.style.opacity = '1'
    })
    unread = 0
    badge.style.display = 'none'
    launcher.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
  }

  function closeChat() {
    open = false
    container.style.transform = 'translateY(12px)'
    container.style.opacity = '0'
    setTimeout(function () {
      if (!open) container.style.display = 'none'
    }, 220)
    launcher.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>'
  }

  launcher.addEventListener('click', function () {
    open ? closeChat() : openChat()
  })

  // Listen for new-message events from the iframe so we can show the badge
  window.addEventListener('message', function (ev) {
    if (ev.data && ev.data.type === 'sc_new_message' && !open) {
      unread++
      badge.textContent = unread > 9 ? '9+' : String(unread)
      badge.style.display = 'block'
    }
  })

  document.body.appendChild(container)
  document.body.appendChild(launcher)
})()
