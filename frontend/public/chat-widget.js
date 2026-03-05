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

  // ── Tab bar (Chat / Menu) — hidden until menus load ───────────────────
  var tabBar = document.createElement('div')
  tabBar.id = 'sc-chat-tabs'
  Object.assign(tabBar.style, {
    display: 'none',
    flexDirection: 'row',
    borderBottom: '1px solid #e5e7eb',
    background: '#fff',
    borderRadius: '16px 16px 0 0',
    overflow: 'hidden',
    flexShrink: '0',
  })

  function createTab(label, isActive) {
    var btn = document.createElement('button')
    btn.textContent = label
    Object.assign(btn.style, {
      flex: '1',
      padding: '10px 0',
      border: 'none',
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: '600',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      background: isActive ? '#fff' : '#f9fafb',
      color: isActive ? '#4f46e5' : '#6b7280',
      borderBottom: isActive ? '2px solid #4f46e5' : '2px solid transparent',
      transition: 'all 0.15s ease',
    })
    return btn
  }

  var chatTab = createTab('Chat', true)
  var menuTab = createTab('Menu', false)
  tabBar.appendChild(chatTab)
  tabBar.appendChild(menuTab)
  container.appendChild(tabBar)

  // ── Chat iframe ──────────────────────────────────────────────────────
  var iframe = document.createElement('iframe')
  iframe.src = WIDGET_URL
  iframe.title = 'Live Chat'
  Object.assign(iframe.style, {
    width: '100%',
    height: '100%',
    border: 'none',
    borderRadius: '0 0 16px 16px',
    flex: '1',
  })
  container.appendChild(iframe)

  // ── Menu panel ───────────────────────────────────────────────────────
  var menuPanel = document.createElement('div')
  menuPanel.id = 'sc-menu-panel'
  Object.assign(menuPanel.style, {
    display: 'none',
    flex: '1',
    overflowY: 'auto',
    background: '#f9fafb',
    padding: '16px',
    borderRadius: '0 0 16px 16px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  })
  container.appendChild(menuPanel)

  var activeTab = 'chat'
  var menuData = []

  function switchTab(tab) {
    activeTab = tab
    if (tab === 'chat') {
      iframe.style.display = 'block'
      menuPanel.style.display = 'none'
      chatTab.style.background = '#fff'
      chatTab.style.color = '#4f46e5'
      chatTab.style.borderBottom = '2px solid #4f46e5'
      menuTab.style.background = '#f9fafb'
      menuTab.style.color = '#6b7280'
      menuTab.style.borderBottom = '2px solid transparent'
    } else {
      iframe.style.display = 'none'
      menuPanel.style.display = 'block'
      menuTab.style.background = '#fff'
      menuTab.style.color = '#4f46e5'
      menuTab.style.borderBottom = '2px solid #4f46e5'
      chatTab.style.background = '#f9fafb'
      chatTab.style.color = '#6b7280'
      chatTab.style.borderBottom = '2px solid transparent'
      renderMenu()
    }
  }

  chatTab.addEventListener('click', function () { switchTab('chat') })
  menuTab.addEventListener('click', function () { switchTab('menu') })

  function renderMenu() {
    menuPanel.innerHTML = ''
    if (menuData.length === 0) {
      menuPanel.innerHTML = '<p style="text-align:center;color:#9ca3af;font-size:13px;padding:40px 0;">No menu items available.</p>'
      return
    }
    menuData.forEach(function (group) {
      var items = (group.items || []).filter(function (i) { return i.is_active })
      if (items.length === 0) return

      var header = document.createElement('p')
      header.textContent = (group.icon || '') + ' ' + group.name
      Object.assign(header.style, {
        fontSize: '11px',
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: '#6b7280',
        marginBottom: '8px',
        marginTop: '12px',
      })
      menuPanel.appendChild(header)

      items.forEach(function (item) {
        var link = document.createElement('a')
        var href = item.link_type === 'form' ? SERVER + '/forms/' + item.link_value : item.link_value
        link.href = href
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.textContent = (item.icon ? item.icon + ' ' : '') + item.label
        Object.assign(link.style, {
          display: 'block',
          padding: '10px 12px',
          marginBottom: '4px',
          background: '#fff',
          borderRadius: '8px',
          color: '#1f2937',
          textDecoration: 'none',
          fontSize: '13px',
          fontWeight: '500',
          border: '1px solid #e5e7eb',
          transition: 'all 0.15s ease',
          cursor: 'pointer',
        })
        link.addEventListener('mouseenter', function () {
          link.style.borderColor = '#a5b4fc'
          link.style.background = '#eef2ff'
        })
        link.addEventListener('mouseleave', function () {
          link.style.borderColor = '#e5e7eb'
          link.style.background = '#fff'
        })
        menuPanel.appendChild(link)
      })
    })
  }

  // Fetch public menus — show tab bar only if menus exist
  fetch(SERVER.replace(':3000', ':8000') + '/menu')
    .then(function (r) { return r.json() })
    .then(function (data) {
      if (data && data.length > 0) {
        menuData = data
        tabBar.style.display = 'flex'
      }
    })
    .catch(function () {})

  var open = false
  var unread = 0

  function playNotificationSound() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)()
      var osc = ctx.createOscillator()
      var gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.08)
      gain.gain.setValueAtTime(0.28, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.3)
    } catch (e) {}
  }

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

  // Listen for new-message events from the iframe so we can show the badge + play sound
  window.addEventListener('message', function (ev) {
    if (ev.data && ev.data.type === 'sc_new_message' && !open) {
      unread++
      badge.textContent = unread > 9 ? '9+' : String(unread)
      badge.style.display = 'block'
      playNotificationSound()
    }
  })

  document.body.appendChild(container)
  document.body.appendChild(launcher)
})()
