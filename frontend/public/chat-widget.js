/**
 * SocialMedia Live Chat Widget
 * Embed on any website with:
 *   <script src="https://your-domain.com/chat-widget.js" data-key="your-widget-key-here"></script>
 *
 * Optional config (set before the script tag):
 *   window.SocialChatConfig = { serverUrl: 'https://your-domain.com' }
 */
;(function () {
  var config = window.SocialChatConfig || {}
  var SERVER = config.serverUrl || window.location.origin
  var WIDGET_URL = SERVER + '/widget'
  var BRANDING_URL = SERVER + '/api/webchat/branding'  // proxied via Next.js if needed

  // Read widget key from script tag's data-key attribute
  var scriptTag = document.currentScript || document.querySelector('script[data-key]')
  var WIDGET_KEY = scriptTag ? scriptTag.getAttribute('data-key') : null

  // Abort if no key provided
  if (!WIDGET_KEY) return

  // Fetch branding to style the launcher button — abort if key is invalid
  var primaryColor = '#2563eb'
  var brandingUrl = SERVER.replace(':3000', ':8000') + '/webchat/branding?key=' + encodeURIComponent(WIDGET_KEY)
  var brandingReady = false
  fetch(brandingUrl)
    .then(function (r) { return r.json() })
    .then(function (b) {
      if (b.key_valid === false) {
        // Invalid or inactive key — remove widget elements and stop
        if (launcher.parentNode) launcher.parentNode.removeChild(launcher)
        if (container.parentNode) container.parentNode.removeChild(container)
        return
      }
      brandingReady = true
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

  // ── Tab bar (Chat / Menu / Channels) — hidden until tabs needed ───────
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
  var channelsTab = createTab('Channels', false)
  tabBar.appendChild(chatTab)
  tabBar.appendChild(menuTab)
  // channelsTab appended only when channels are available
  container.appendChild(tabBar)

  // ── Chat iframe ──────────────────────────────────────────────────────
  var iframe = document.createElement('iframe')
  iframe.src = WIDGET_KEY ? WIDGET_URL + '?widget_key=' + encodeURIComponent(WIDGET_KEY) : WIDGET_URL
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

  // ── Channels panel ───────────────────────────────────────────────────
  var channelsPanel = document.createElement('div')
  channelsPanel.id = 'sc-channels-panel'
  Object.assign(channelsPanel.style, {
    display: 'none',
    flex: '1',
    overflowY: 'auto',
    background: '#f9fafb',
    padding: '20px 16px',
    borderRadius: '0 0 16px 16px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  })
  container.appendChild(channelsPanel)

  // Official brand SVG icons
  var CHANNEL_ICONS = {
    whatsapp: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"><path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>',
    facebook: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"><path fill="#0099FF" d="M12 0C5.373 0 0 5.373 0 12c0 5.99 4.388 10.954 10.125 11.854V15.47H7.078V12h3.047V9.356c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874V12h3.328l-.532 3.47h-2.796v8.385C19.612 22.954 24 17.99 24 12c0-6.627-5.373-12-12-12z"/></svg>',
    viber: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"><path fill="#7360F2" d="M11.4.006C9.395.05 4.7.404 2.103 2.784.493 4.394-.03 6.747.001 9.673c.03 2.95.473 8.713 5.612 10.253v2.355s-.038.998.621 1.2c.693.234 1.09-.198 3.497-2.978 3.967.334 7.013-.43 7.363-.543.8-.26 5.33-.84 6.07-6.856.766-6.2-.372-10.116-2.461-11.876C19.2.487 16.266-.08 11.4.006zm.166 1.875c4.336-.063 6.97.516 8.4 1.79 1.675 1.44 2.611 4.772 1.94 10.136-.617 5.012-4.23 5.354-4.9 5.569-.291.095-3.005.78-6.47.558 0 0-2.567 3.092-3.363 3.898-.13.13-.28.178-.38.153-.14-.034-.177-.2-.175-.442l.021-3.814s-.003-.009-.009-.022c-4.334-1.249-4.708-6.21-4.734-8.823-.026-2.612.417-4.617 1.738-5.936C5.518 2.866 9.565 1.894 11.566 1.881zm.222 2.626c-.278 0-.278.432 0 .436 3.614.028 5.447 1.887 5.472 5.472.004.284.44.28.436 0-.027-3.807-2.101-5.88-5.908-5.908zm-3.256 1.49c-.344-.01-.697.1-.983.332-.001 0-.002.002-.003.003-.43.362-.78.814-.82 1.32-.04.5.138 1.01.493 1.528l.005.006c.8 1.17 1.75 2.21 2.802 3.133a12.75 12.75 0 001.594 1.13c.003.003.007.005.01.007.4.24.802.448 1.208.563l.024.006c.508.137 1.016.084 1.447-.228.344-.264.677-.596.903-.987.194-.336.163-.688-.024-.936l-1.571-1.534c-.228-.28-.562-.376-.862-.226-.301.15-.601.343-.762.574-.107.15-.284.197-.464.122-.517-.218-1.4-.876-2.005-1.674-.574-.78-.92-1.711-.99-2.248-.037-.19.023-.368.183-.46.254-.142.49-.384.666-.664.175-.28.218-.62.06-.91L9.5 6.284c-.17-.258-.494-.387-.768-.291zm4.437.54c-.278 0-.278.432 0 .436 1.986.023 2.996 1.033 3.018 3.018.004.284.44.28.436 0-.025-2.209-1.245-3.428-3.454-3.454zm-1.113 1.137c-.278 0-.278.433 0 .437.99.007 1.48.497 1.488 1.487.003.284.439.28.435 0-.011-1.214-.71-1.913-1.923-1.924z"/></svg>',
    linkedin: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"><path fill="#0A66C2" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>',
  }

  var CHANNEL_COLORS = {
    whatsapp: { bg: '#e8fdf0', border: '#b7f0cc', hover: '#d1fae5' },
    facebook: { bg: '#e8f4ff', border: '#b3d9ff', hover: '#dbeafe' },
    viber:    { bg: '#f0ecff', border: '#d4c8fc', hover: '#ede9fe' },
    linkedin: { bg: '#e8f0fb', border: '#b3cbf0', hover: '#dbeafe' },
  }

  function renderChannels() {
    channelsPanel.innerHTML = ''
    if (!channelsData || channelsData.length === 0) {
      channelsPanel.innerHTML = '<p style="text-align:center;color:#9ca3af;font-size:13px;padding:40px 0;">No channels available.</p>'
      return
    }
    var title = document.createElement('p')
    title.textContent = 'Connect with us on'
    Object.assign(title.style, {
      fontSize: '13px', fontWeight: '700', color: '#374151',
      marginBottom: '14px', marginTop: '4px', textAlign: 'center',
    })
    channelsPanel.appendChild(title)

    channelsData.forEach(function (ch) {
      var colors = CHANNEL_COLORS[ch.platform] || { bg: '#f9fafb', border: '#e5e7eb', hover: '#f3f4f6' }
      var icon   = CHANNEL_ICONS[ch.platform] || ''

      var link = document.createElement('a')
      link.href = ch.url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      Object.assign(link.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '13px 14px',
        marginBottom: '8px',
        background: colors.bg,
        border: '1px solid ' + colors.border,
        borderRadius: '12px',
        textDecoration: 'none',
        transition: 'all 0.15s ease',
        cursor: 'pointer',
      })
      link.addEventListener('mouseenter', function () { link.style.background = colors.hover })
      link.addEventListener('mouseleave', function () { link.style.background = colors.bg })

      var iconWrap = document.createElement('span')
      iconWrap.innerHTML = icon
      Object.assign(iconWrap.style, { display: 'flex', alignItems: 'center', flexShrink: '0' })

      var textWrap = document.createElement('span')
      Object.assign(textWrap.style, { display: 'flex', flexDirection: 'column', gap: '1px' })

      var labelEl = document.createElement('span')
      labelEl.textContent = ch.label
      Object.assign(labelEl.style, {
        fontSize: '14px', fontWeight: '600', color: '#111827', lineHeight: '1.3',
      })

      var subEl = document.createElement('span')
      subEl.textContent = 'Chat with us on ' + ch.label
      Object.assign(subEl.style, { fontSize: '11px', color: '#6b7280', lineHeight: '1.3' })

      var arrowEl = document.createElement('span')
      arrowEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>'
      Object.assign(arrowEl.style, { marginLeft: 'auto', display: 'flex', alignItems: 'center' })

      textWrap.appendChild(labelEl)
      textWrap.appendChild(subEl)
      link.appendChild(iconWrap)
      link.appendChild(textWrap)
      link.appendChild(arrowEl)
      channelsPanel.appendChild(link)
    })
  }

  var activeTab = 'chat'
  var menuData = []
  var channelsData = []

  function setTabActive(btn) {
    ;[chatTab, menuTab, channelsTab].forEach(function (t) {
      t.style.background = '#f9fafb'
      t.style.color = '#6b7280'
      t.style.borderBottom = '2px solid transparent'
    })
    btn.style.background = '#fff'
    btn.style.color = '#4f46e5'
    btn.style.borderBottom = '2px solid #4f46e5'
  }

  function switchTab(tab) {
    activeTab = tab
    iframe.style.display = 'none'
    menuPanel.style.display = 'none'
    channelsPanel.style.display = 'none'
    if (tab === 'chat') {
      iframe.style.display = 'block'
      setTabActive(chatTab)
    } else if (tab === 'menu') {
      menuPanel.style.display = 'block'
      setTabActive(menuTab)
      renderMenu()
    } else if (tab === 'channels') {
      channelsPanel.style.display = 'block'
      setTabActive(channelsTab)
      renderChannels()
    }
  }

  chatTab.addEventListener('click', function () { switchTab('chat') })
  menuTab.addEventListener('click', function () { switchTab('menu') })
  channelsTab.addEventListener('click', function () { switchTab('channels') })

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

  // Fetch public menus + channels — show tab bar only when tabs are needed
  function _showTabBar() { tabBar.style.display = 'flex' }

  fetch(SERVER.replace(':3000', ':8000') + '/menu')
    .then(function (r) { return r.json() })
    .then(function (data) {
      if (data && data.length > 0) {
        menuData = data
        _showTabBar()
      }
    })
    .catch(function () {})

  var channelsUrl = SERVER.replace(':3000', ':8000') + '/webchat/channels'
  if (WIDGET_KEY) channelsUrl += '?key=' + encodeURIComponent(WIDGET_KEY)
  fetch(channelsUrl)
    .then(function (r) { return r.json() })
    .then(function (data) {
      if (data && data.length > 0) {
        channelsData = data
        tabBar.appendChild(channelsTab)
        _showTabBar()
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
