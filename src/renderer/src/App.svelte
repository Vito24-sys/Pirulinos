<script lang="ts">
  import { onMount } from 'svelte'

  interface Peer {
    userId: string
    username: string
    ip: string
    lastSeen: number
  }

  interface Message {
    id: string
    senderId: string
    username: string
    text: string
    timestamp: number
    isMe: boolean
  }

  let myProfile: { userId: string; username: string } | null = null
  let usernameInput = ''
  let isLoading = true
  let errorMessage = ''

  // Contactos detectados en la misma Wi-Fi
  let peers: Record<string, Peer> = {}

  // Contacto seleccionado actualmente para chatear
  let selectedPeerId: string | null = null

  // Historial de mensajes separado por contacto: { [userId]: Message[] }
  let conversations: Record<string, Message[]> = {}

  // Contador de mensajes no leídos por cada contacto
  let unreadCounts: Record<string, number> = {}

  let chatInput = ''
  let chatContainer: HTMLDivElement

  // Genera un color consistente según el nombre para el avatar
  function getAvatarColor(name: string): string {
    const colors = [
      'bg-emerald-600',
      'bg-teal-600',
      'bg-cyan-600',
      'bg-sky-600',
      'bg-indigo-600',
      'bg-violet-600',
      'bg-purple-600',
      'bg-rose-600'
    ]
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash)
    }
    return colors[Math.abs(hash) % colors.length]
  }

  onMount(async () => {
    try {
      if (!window.api || typeof window.api.getProfile !== 'function') {
        throw new Error('window.api no está disponible. Comprueba el script de preload.')
      }

      myProfile = await window.api.getProfile()

      window.api.onLanPacket((packet) => {
        // 1. Detección de presencia (usuarios con la app en la Wi-Fi)
        if (packet.type === 'presence') {
          peers[packet.senderId] = {
            userId: packet.senderId,
            username: packet.username,
            ip: packet.ip || 'Local',
            lastSeen: Date.now()
          }
          peers = { ...peers }
        }

        // 2. Mensaje privado recibido de un contacto
        if (packet.type === 'direct_chat' && packet.text && packet.timestamp) {
          const fromId = packet.senderId

          if (!conversations[fromId]) {
            conversations[fromId] = []
          }

          conversations[fromId].push({
            id: Math.random().toString(),
            senderId: fromId,
            username: packet.username,
            text: packet.text,
            timestamp: packet.timestamp,
            isMe: false
          })
          conversations = { ...conversations }

          // Si el mensaje es del chat que tenemos abierto, scrolleamos abajo
          if (selectedPeerId === fromId) {
            scrollToBottom()
          } else {
            // Si tenemos otro chat abierto, sumamos a no leídos
            unreadCounts[fromId] = (unreadCounts[fromId] || 0) + 1
            unreadCounts = { ...unreadCounts }
          }
        }
      })
    } catch (err: any) {
      console.error(err)
      errorMessage = err.message || 'Error de conexión'
    } finally {
      isLoading = false
    }

    // Limpieza: si un contacto no emite señales en 9 segundos, desaparece
    const interval = setInterval(() => {
      const now = Date.now()
      let hasChanges = false

      for (const [id, peer] of Object.entries(peers)) {
        if (now - peer.lastSeen > 9000) {
          delete peers[id]
          if (selectedPeerId === id) {
            selectedPeerId = null
          }
          hasChanges = true
        }
      }

      if (hasChanges) {
        peers = { ...peers }
      }
    }, 3000)

    return () => clearInterval(interval)
  })

  async function handleRegister() {
    const trimmed = usernameInput.trim()
    if (!trimmed || !window.api) return
    myProfile = await window.api.createProfile(trimmed)
  }

  function selectContact(peerId: string) {
    selectedPeerId = peerId
    // Limpiamos los no leídos al abrir el chat
    if (unreadCounts[peerId]) {
      delete unreadCounts[peerId]
      unreadCounts = { ...unreadCounts }
    }
    scrollToBottom()
  }

  function handleSendMessage() {
    const text = chatInput.trim()
    if (!text || !myProfile || !selectedPeerId || !window.api) return

    // 1. Envía el mensaje privado al usuario seleccionado
    window.api.sendDirectMessage(selectedPeerId, text)

    // 2. Guarda el mensaje en nuestra conversación local con él
    if (!conversations[selectedPeerId]) {
      conversations[selectedPeerId] = []
    }

    conversations[selectedPeerId].push({
      id: Math.random().toString(),
      senderId: myProfile.userId,
      username: myProfile.username,
      text,
      timestamp: Date.now(),
      isMe: true
    })
    conversations = { ...conversations }

    chatInput = ''
    scrollToBottom()
  }

  function scrollToBottom() {
    setTimeout(() => {
      if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight
      }
    }, 40)
  }

  // Obtiene el último mensaje para mostrar la vista previa en la lista
  function getLastMessage(peerId: string): string {
    const list = conversations[peerId]
    if (!list || list.length === 0) return 'Toca para iniciar una conversación'
    const last = list[list.length - 1]
    return last.isMe ? `Tú: ${last.text}` : last.text
  }

  function getLastMessageTime(peerId: string): string {
    const list = conversations[peerId]
    if (!list || list.length === 0) return ''
    const last = list[list.length - 1]
    return new Date(last.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
</script>

<div class="h-screen w-screen bg-[#111b21] text-[#e9edef] select-none font-sans overflow-hidden antialiased">
  {#if isLoading}
    <div class="h-full flex items-center justify-center text-sm text-[#8696a0]">
      Cargando WhatsApp LAN...
    </div>

  {:else if errorMessage}
    <div class="h-full flex items-center justify-center p-6 text-center">
      <div class="bg-red-950/40 border border-red-800/60 p-6 rounded-2xl max-w-md">
        <h2 class="text-red-400 font-bold mb-2">Error de Conexión</h2>
        <p class="text-sm text-neutral-300">{errorMessage}</p>
      </div>
    </div>

  {:else if !myProfile}
    <!-- PANTALLA INICIAL DE REGISTRO -->
    <div class="h-full flex items-center justify-center p-6 bg-[#0c1317]">
      <div class="w-full max-w-md bg-[#202c33] border border-[#2a3942] rounded-2xl p-8 shadow-2xl">
        <div class="flex items-center gap-3 mb-2">
          <div class="w-10 h-10 rounded-full bg-[#00a884] flex items-center justify-center text-white font-bold text-lg shadow-sm">
            W
          </div>
          <div>
            <h1 class="text-xl font-bold text-white">WhatsApp LAN</h1>
            <p class="text-xs text-[#00a884]">Red Local Privada</p>
          </div>
        </div>
        <p class="text-sm text-[#8696a0] mt-3 mb-6">
          Ingresa tu nombre o apodo para que otros usuarios en tu misma red Wi-Fi puedan identificarte y chatear contigo.
        </p>

        <form on:submit|preventDefault={handleRegister} class="space-y-5">
          <div>
            <label for="username" class="block text-xs font-semibold text-[#8696a0] uppercase tracking-wider mb-2">
              Tu Nombre
            </label>
            <input
              id="username"
              type="text"
              bind:value={usernameInput}
              placeholder="Ej: Vito"
              autofocus
              class="w-full bg-[#111b21] border border-[#2a3942] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#00a884] text-white placeholder-[#8696a0] transition"
            />
          </div>

          <button
            type="submit"
            disabled={!usernameInput.trim()}
            class="w-full bg-[#00a884] hover:bg-[#02906f] disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm transition cursor-pointer"
          >
            Entrar al chat
          </button>
        </form>
      </div>
    </div>

  {:else}
    <!-- INTERFAZ PRINCIPAL TIPO WHATSAPP WEB -->
    <div class="flex h-full w-full">
      
      <!-- COLUMNA IZQUIERDA: LISTA DE CONTACTOS -->
      <aside class="w-[360px] bg-[#111b21] border-r border-[#222d34] flex flex-col h-full shrink-0">
        <!-- Header de usuario -->
        <header class="h-16 bg-[#202c33] px-4 flex items-center justify-between border-b border-[#222d34]">
          <div class="flex items-center gap-3">
            <div class={`w-10 h-10 rounded-full ${getAvatarColor(myProfile.username)} flex items-center justify-center text-white font-bold text-base shadow`}>
              {myProfile.username.charAt(0).toUpperCase()}
            </div>
            <div>
              <div class="text-sm font-semibold text-white leading-tight">{myProfile.username}</div>
              <div class="text-[11px] text-[#00a884] flex items-center gap-1.5 mt-0.5">
                <span class="w-2 h-2 rounded-full bg-[#00a884] animate-pulse"></span> En tu red Wi-Fi
              </div>
            </div>
          </div>
          <span class="text-[11px] text-[#8696a0] font-mono">ID: {myProfile.userId}</span>
        </header>

        <!-- Subheader / Título de la lista -->
        <div class="px-4 py-3 bg-[#111b21] border-b border-[#222d34]/60">
          <div class="text-xs font-semibold uppercase tracking-wider text-[#8696a0]">
            Contactos en tu red ({Object.keys(peers).length})
          </div>
        </div>

        <!-- Lista scrolleable de contactos -->
        <div class="flex-1 overflow-y-auto">
          {#if Object.keys(peers).length === 0}
            <div class="p-8 text-center text-[#8696a0]">
              <div class="w-12 h-12 rounded-full bg-[#202c33] mx-auto flex items-center justify-center mb-3 text-lg">
                📶
              </div>
              <p class="text-sm font-medium text-white mb-1">Buscando usuarios...</p>
              <p class="text-xs leading-relaxed">
                Pídele a otra persona en esta misma red Wi-Fi que abra la aplicación para que aparezca aquí.
              </p>
            </div>
          {:else}
            {#each Object.values(peers) as peer (peer.userId)}
              <button
                type="button"
                on:click={() => selectContact(peer.userId)}
                class={`w-full px-4 py-3 flex items-center gap-3 text-left transition border-b border-[#222d34]/40 cursor-pointer ${
                  selectedPeerId === peer.userId ? 'bg-[#2a3942]' : 'hover:bg-[#202c33]/60'
                }`}
              >
                <!-- Avatar del contacto -->
                <div class="relative shrink-0">
                  <div class={`w-12 h-12 rounded-full ${getAvatarColor(peer.username)} flex items-center justify-center text-white font-bold text-lg shadow`}>
                    {peer.username.charAt(0).toUpperCase()}
                  </div>
                  <span class="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-[#00a884] border-2 border-[#111b21]"></span>
                </div>

                <!-- Info y último mensaje -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between mb-0.5">
                    <span class="text-sm font-medium text-white truncate">{peer.username}</span>
                    <span class="text-[11px] text-[#8696a0] shrink-0 font-mono">
                      {getLastMessageTime(peer.userId)}
                    </span>
                  </div>

                  <div class="flex items-center justify-between">
                    <p class="text-xs text-[#8696a0] truncate max-w-[200px]">
                      {getLastMessage(peer.userId)}
                    </p>

                    <!-- Badge de no leídos -->
                    {#if unreadCounts[peer.userId]}
                      <span class="ml-2 bg-[#00a884] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                        {unreadCounts[peer.userId]}
                      </span>
                    {/if}
                  </div>
                </div>
              </button>
            {/each}
          {/if}
        </div>
      </aside>

      <!-- COLUMNA DERECHA: CONVERSACIÓN O PANTALLA DE BIENVENIDA -->
      {#if !selectedPeerId || !peers[selectedPeerId]}
        <!-- PANTALLA DE ESPERA (Igual a WhatsApp Web sin chat abierto) -->
        <main class="flex-1 bg-[#222e35]/30 flex flex-col items-center justify-center text-center p-8 border-b-8 border-[#00a884]">
          <div class="w-20 h-20 rounded-full bg-[#202c33] flex items-center justify-center mb-6 text-3xl shadow-inner">
            💬
          </div>
          <h2 class="text-2xl font-light text-[#e9edef] mb-2">Pirulinos</h2>
          <p class="text-sm text-[#8696a0] max-w-md leading-relaxed">
            Envía y recibe mensajes privados sin conexión a internet ni servidores centrales. Selecciona un contacto de la barra lateral para comenzar.
          </p>
          <div class="mt-8 text-xs text-[#8696a0] flex items-center gap-1.5 font-mono">
            <span>🔒</span> Conexión directa peer-to-peer en tu red Wi-Fi
          </div>
        </main>
      {:else}
        <!-- CHAT ACTIVO CON EL CONTACTO SELECCIONADO -->
        <main class="flex-1 flex flex-col h-full bg-[#0b141a] relative">
          
          <!-- Encabezado del chat con el contacto -->
          <header class="h-16 bg-[#202c33] px-4 flex items-center justify-between border-b border-[#222d34] z-10 shadow-sm">
            <div class="flex items-center gap-3">
              <div class={`w-10 h-10 rounded-full ${getAvatarColor(peers[selectedPeerId].username)} flex items-center justify-center text-white font-bold text-base`}>
                {peers[selectedPeerId].username.charAt(0).toUpperCase()}
              </div>
              <div>
                <div class="text-sm font-semibold text-white leading-tight">
                  {peers[selectedPeerId].username}
                </div>
                <div class="text-xs text-[#00a884] mt-0.5">En línea</div>
              </div>
            </div>
            <div class="text-xs text-[#8696a0] font-mono">
              IP: {peers[selectedPeerId].ip}
            </div>
          </header>

          <!-- Lista de mensajes con estilo WhatsApp -->
          <div bind:this={chatContainer} class="flex-1 overflow-y-auto p-6 space-y-2.5">
            {#if !conversations[selectedPeerId] || conversations[selectedPeerId].length === 0}
              <div class="h-full flex flex-col items-center justify-center text-[#8696a0]">
                <div class="bg-[#182229] border border-[#222d34] px-4 py-2 rounded-lg text-xs text-center shadow">
                  🔒 Los mensajes enviados entre tú y <span class="font-bold text-white">{peers[selectedPeerId].username}</span> solo viajan por esta red Wi-Fi.
                </div>
              </div>
            {:else}
              {#each conversations[selectedPeerId] as msg (msg.id)}
                <div class={`flex flex-col ${msg.isMe ? 'items-end' : 'items-start'}`}>
                  <div
                    class={`max-w-[65%] px-3.5 py-2 rounded-lg text-sm leading-relaxed shadow relative ${
                      msg.isMe
                        ? 'bg-[#005c4b] text-[#e9edef] rounded-tr-none'
                        : 'bg-[#202c33] text-[#e9edef] rounded-tl-none'
                    }`}
                  >
                    <div>{msg.text}</div>
                    
                    <div class="flex items-center justify-end gap-1 mt-1">
                      <span class="text-[10px] text-[#8696a0] font-mono">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {#if msg.isMe}
                        <!-- Check doble característico de WhatsApp -->
                        <span class="text-[11px] text-[#53bdeb] font-bold leading-none">✓✓</span>
                      {/if}
                    </div>
                  </div>
                </div>
              {/each}
            {/if}
          </div>

          <!-- Barra inferior de escritura -->
          <footer class="h-16 bg-[#202c33] px-4 flex items-center border-t border-[#222d34]">
            <form on:submit|preventDefault={handleSendMessage} class="flex items-center gap-3 w-full">
              <input
                type="text"
                bind:value={chatInput}
                placeholder={`Escribe un mensaje para ${peers[selectedPeerId].username}...`}
                class="flex-1 bg-[#2a3942] border-none rounded-lg px-4 py-2.5 text-sm text-white placeholder-[#8696a0] focus:outline-none transition"
              />
              <button
                type="submit"
                disabled={!chatInput.trim()}
                class="bg-[#00a884] hover:bg-[#02906f] disabled:opacity-40 text-white font-medium p-2.5 rounded-full transition shadow cursor-pointer flex items-center justify-center shrink-0"
                title="Enviar"
              >
                <!-- Icono de avión de papel -->
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
                  <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
                </svg>
              </button>
            </form>
          </footer>
        </main>
      {/if}
    </div>
  {/if}
</div>