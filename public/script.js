
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Loaded, Initializing App...");

    // --- CONFIG & STATE ---
    let socket;
    try {
        const ioClient = require('socket.io-client');
        socket = ioClient('http://localhost:3000/', { transports: ['websocket'], reconnectionAttempts: 10 });
        console.log("Socket initialized via require (Electron)");
    } catch (e) {
        console.log("Socket fallback to CDN");
        // Use relative path for web (Render/Browser) to auto-detect origin
        socket = io({
            transports: ['websocket'],
            reconnectionAttempts: 10
        });
    }

    socket.on('connect_error', (err) => {
        console.error("Socket Connection Error:", err);
        alert("Sunucuya ba\u011flan\u0131lamad\u0131! L\u00fctfen uygulaman\u0131n a\u00e7\u0131k oldu\u011fundan emin olun.");
    });

    socket.on('error', (err) => { console.error("Socket Error:", err); });

    // --- RECONNECTION LOGIC ---
    socket.on('connect', () => {
        console.log("Socket connected:", socket.id);

        // --- REGISTER PERSISTENT REMOTE ID ---
        const savedRemoteId = localStorage.getItem('my_remote_id');
        if (savedRemoteId) {
            console.log("Requesting previous Remote ID:", savedRemoteId);
            socket.emit('register-remote-id', savedRemoteId);
        } else {
            socket.emit('register-remote-id', null); // Request new
        }

        if (myState.username && loginOverlay.classList.contains('hidden')) {
            console.log("Reconnecting user:", myState.username);
            myState.isReconnecting = true;
            socket.emit('login', { username: myState.username, avatar: myState.avatar, adminKey: myState.adminKey });
        }
    });

    // Global State
    let myState = {
        username: localStorage.getItem('chat_username') || '',
        avatar: localStorage.getItem('chat_avatar') || 'https://cdn-icons-png.flaticon.com/512/847/847969.png',
        color: localStorage.getItem('chat_color') || getRandomColor(),
        adminKey: '',
        role: 'user',
        room: null,
        stream: null,
        screenStream: null,
        isReconnecting: false
    };

    const myPeer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    let ipcRenderer, desktopCapturer;

    try {
        const electron = require('electron');
        ipcRenderer = electron.ipcRenderer;
        desktopCapturer = electron.desktopCapturer;
    } catch (e) {
        console.warn("Electron module import issue:", e);
    }

    let peers = {};
    let audioContext;
    let roomConfigs = {};

    // --- DOM ELEMENTS ---
    const loginOverlay = document.getElementById('login-overlay');
    const activeRoomView = document.getElementById('active-room-view');
    const videoGrid = document.getElementById('video-grid');
    const roomListContainer = document.getElementById('room-list-container');
    const chatMessages = document.getElementById('chat-messages');
    const myAvatarPreviewMini = document.getElementById('my-avatar-preview-mini');
    const myUsernameDisplay = document.getElementById('my-username-display');
    const avatarPreview = document.getElementById('avatar-preview');
    const usernameInput = document.getElementById('username-input');
    const adminKeyInput = document.getElementById('admin-key-input');
    const contextMenu = document.getElementById('context-menu');
    const banListModal = document.getElementById('ban-list-modal');
    const roomConfigModal = document.getElementById('room-config-modal');
    const passwordModal = document.getElementById('password-modal');
    const btnBanList = document.getElementById('btn-ban-list');

    // --- INIT ---
    if (myState.username && usernameInput) usernameInput.value = myState.username;
    if (myState.avatar && avatarPreview) avatarPreview.src = myState.avatar;

    // Window Controls
    const minBtn = document.getElementById('min-btn');
    const closeBtn = document.getElementById('close-btn');
    if (minBtn) minBtn.addEventListener('click', () => ipcRenderer?.send('minimize-app'));
    if (closeBtn) closeBtn.addEventListener('click', () => ipcRenderer?.send('close-app'));

    // --- AUTO UPDATE HANDLERS ---
    if (ipcRenderer) {
        const updateNotif = document.getElementById('update-notification');
        const updateMsg = document.getElementById('update-message');
        const restartBtn = document.getElementById('restart-btn');

        ipcRenderer.on('update_available', () => {
            ipcRenderer.removeAllListeners('update_available');
            updateMsg.innerText = "Yeni bir güncelleme bulundu. İndiriliyor...";
            updateNotif.classList.remove('hidden');
        });

        ipcRenderer.on('update_downloaded', () => {
            ipcRenderer.removeAllListeners('update_downloaded');
            updateMsg.innerText = "Güncelleme indirildi. Yüklemek için yeniden başlatın.";
            restartBtn.classList.remove('hidden');
            restartBtn.addEventListener('click', () => {
                ipcRenderer.send('restart_app');
            });
        });
    }

    function getRandomColor() {
        const letters = '89ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) color += letters[Math.floor(Math.random() * 16)];
        return color;
    }

    // --- LOGIN ---
    const fileInput = document.getElementById('avatar-file-input');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const maxSize = 200;
                    let width = img.width, height = img.height;
                    if (width > height) { if (width > maxSize) { height *= maxSize / width; width = maxSize; } }
                    else { if (height > maxSize) { width *= maxSize / height; height = maxSize; } }
                    canvas.width = width; canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                    avatarPreview.src = dataUrl;
                    myState.avatar = dataUrl;
                };
            };
            reader.readAsDataURL(file);
        });
    }

    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const user = usernameInput.value.trim();
            if (!user) return alert("Kullan\u0131c\u0131 ad\u0131 gerekli");

            myState.username = user;
            myState.adminKey = adminKeyInput.value.trim();
            if (avatarPreview.src) myState.avatar = avatarPreview.src;

            localStorage.setItem('chat_username', myState.username);
            localStorage.setItem('chat_avatar', myState.avatar);
            localStorage.setItem('chat_color', myState.color);

            try {
                myState.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                setupAudioControls();
                setupAudioAnalysis(myState.stream);
            } catch (e) {
                console.error(e);
                alert("Mikrofon hatas\u0131 (ancak giri\u015f yap\u0131l\u0131yor): " + e.message);
            }

            if (!socket.connected) {
                alert("HATA: Sunucu ile ba\u011flant\u0131 yok! Server kapal\u0131 olabilir.");
            }

            socket.emit('login', {
                username: myState.username,
                avatar: myState.avatar,
                adminKey: myState.adminKey
            });
        });
    }

    socket.on('login-success', (data) => {
        myState.role = data.role;
        if (myState.isReconnecting && myState.room) {
            joinRoom(myState.room);
            myState.isReconnecting = false;
        }

        if (loginOverlay) loginOverlay.classList.add('hidden');
        if (myAvatarPreviewMini) {
            myAvatarPreviewMini.src = myState.avatar;
            myAvatarPreviewMini.classList.remove('hidden');
        }
        if (myUsernameDisplay) {
            myUsernameDisplay.innerText = myState.username;
            myUsernameDisplay.style.color = myState.color;
        }

        const roleBadge = document.getElementById('my-role-badge');
        if (roleBadge) roleBadge.style.display = 'none';
        if (btnBanList) btnBanList.classList.add('hidden');

        if (myState.role === 'admin') {
            if (roleBadge) roleBadge.style.display = 'inline';
            if (btnBanList) btnBanList.classList.remove('hidden');
        }
        socket.emit('get-rooms');
    });

    // --- ROOM LOGIC ---
    socket.on('room-config-update', (configs) => { roomConfigs = configs; });

    socket.on('room-list-update', (roomState) => {
        try {
            if (roomListContainer) {
                roomListContainer.innerHTML = '';
                if (!roomState || Object.keys(roomState).length === 0) {
                    roomListContainer.innerHTML = '<div style="padding:10px; color:#666;">Oda listesi bo\u015f...</div>';
                    return;
                }

                for (const [roomName, usersInRoom] of Object.entries(roomState)) {
                    const div = document.createElement('div');
                    div.className = 'room-item';
                    const amIHere = Array.isArray(usersInRoom) && usersInRoom.some(u => u.id === socket.id);
                    if (amIHere) {
                        div.classList.add('active');
                        myState.room = roomName;
                    }

                    const titleRow = document.createElement('div');
                    titleRow.className = 'room-name';
                    titleRow.style.display = 'flex';
                    titleRow.style.justifyContent = 'space-between';
                    titleRow.style.alignItems = 'center';

                    const nameSpan = document.createElement('span');
                    let lockedIcon = '';
                    if (roomConfigs[roomName]?.password) lockedIcon = ' \uD83D\uDD12'; // Lock emoji
                    nameSpan.innerText = roomName + lockedIcon;
                    titleRow.appendChild(nameSpan);

                    // Check Admin Settings
                    if (myState.role === 'admin') {
                        const settingsBtn = document.createElement('span');
                        // USE FONTAWESOME ICON HERE TO FIX ENCODING
                        settingsBtn.innerHTML = '<i class="fas fa-cog"></i>';
                        settingsBtn.style.cursor = 'pointer';
                        settingsBtn.style.padding = '0 5px';
                        settingsBtn.title = "Oda Ayarlar\u0131";
                        settingsBtn.onclick = (e) => {
                            e.stopPropagation();
                            openRoomConfig(roomName, e);
                        };
                        titleRow.appendChild(settingsBtn);
                    }
                    div.appendChild(titleRow);

                    const avatarDiv = document.createElement('div');
                    avatarDiv.className = 'room-avatars';
                    if (Array.isArray(usersInRoom)) {
                        usersInRoom.forEach(u => {
                            const row = document.createElement('div');
                            row.className = 'mini-user-row';
                            const img = document.createElement('img');
                            img.src = u.avatar;
                            img.className = 'mini-avatar';
                            const nameSpan = document.createElement('span');
                            nameSpan.innerText = u.username;
                            row.appendChild(img);
                            row.appendChild(nameSpan);
                            avatarDiv.appendChild(row);
                        });
                    }
                    div.appendChild(avatarDiv);

                    div.onclick = (e) => { joinRoom(roomName); };
                    roomListContainer.appendChild(div);
                }
            }
        } catch (e) {
            console.error("Room Render Error:", e);
        }
    });

    let pendingRoom = null;
    async function joinRoom(roomName, password = null) {
        if (myState.room === roomName && !password) return;
        pendingRoom = roomName;
        if (myState.room && myState.room !== roomName) {
            if (activeRoomView) activeRoomView.classList.add('hidden');
            if (videoGrid) videoGrid.innerHTML = '';
            if (chatMessages) chatMessages.innerHTML = '';
            Object.values(peers).forEach(p => p.close());
            peers = {};
            document.querySelectorAll('audio').forEach(a => a.remove());
        }
        const title = document.getElementById('current-room-title');
        if (title) title.innerText = roomName;
        socket.emit('join-room', roomName, {
            username: myState.username,
            avatar: myState.avatar,
            color: myState.color,
            adminKey: myState.adminKey,
            password: password
        });
    }

    socket.on('password-required', (data) => {
        if (pendingRoom === data.roomId && document.getElementById('room-pass-input').value !== '') {
            alert("Hatal\u0131 \u015eifre!");
            document.getElementById('room-pass-input').value = '';
        }
        pendingRoom = data.roomId;
        if (passwordModal) passwordModal.classList.remove('hidden');
    });

    const submitPassBtn = document.getElementById('btn-submit-pass');
    if (submitPassBtn) {
        submitPassBtn.addEventListener('click', () => {
            const pass = document.getElementById('room-pass-input').value;
            if (passwordModal) passwordModal.classList.add('hidden');
            if (pendingRoom && pass) joinRoom(pendingRoom, pass);
        });
    }

    const chatForm = document.getElementById('chat-form');
    if (chatForm) {
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const input = document.getElementById('msg-input');
            const text = input.value.trim();
            if (text) {
                socket.emit('send-chat-message', text);
                input.value = '';
            }
        });
    }

    socket.on('joined-success', (data) => {
        myState.role = data.role;
        myState.room = data.roomId;
        if (activeRoomView) activeRoomView.classList.remove('hidden');
        if (myState.role === 'admin') {
            const roleBadge = document.getElementById('my-role-badge');
            if (roleBadge) roleBadge.style.display = 'inline';
            if (btnBanList) btnBanList.classList.remove('hidden');
        }
    });

    socket.on('role-update', (data) => {
        if (data.role === 'admin') {
            myState.role = 'admin';
            const roleBadge = document.getElementById('my-role-badge');
            if (roleBadge) roleBadge.style.display = 'inline';
            if (btnBanList) btnBanList.classList.remove('hidden');
            alert("Y\u00f6netici yetkisi verildi!");
            socket.emit('get-rooms');
        }
    });

    // --- CONTEXT MENU ---
    let contextTargetId = null;
    document.addEventListener('contextmenu', (e) => {
        if (myState.role !== 'admin') return;
        const target = e.target.closest('.user-card-video-wrapper') || e.target.closest('.message');
        let userId = null;
        if (target && target.id.startsWith('user-card-')) {
            userId = target.id.split('user-card-')[1];
        }
        if (userId && userId !== socket.id) {
            e.preventDefault();
            contextTargetId = userId;
            contextMenu.style.top = e.pageY + 'px';
            contextMenu.style.left = e.pageX + 'px';
            contextMenu.classList.remove('hidden');
        }
    });

    document.addEventListener('click', () => { if (contextMenu) contextMenu.classList.add('hidden'); });

    const ctxKick = document.getElementById('ctx-kick');
    const ctxBan = document.getElementById('ctx-ban');
    const ctxMute = document.getElementById('ctx-mute');
    const ctxPromote = document.getElementById('ctx-promote');

    if (ctxKick) ctxKick.onclick = () => { if (contextTargetId) socket.emit('admin-action', { action: 'kick', targetId: contextTargetId }); };
    if (ctxBan) ctxBan.onclick = () => { if (contextTargetId) socket.emit('admin-action', { action: 'ban', targetId: contextTargetId }); };
    if (ctxMute) ctxMute.onclick = () => { if (contextTargetId) socket.emit('admin-action', { action: 'mute', targetId: contextTargetId }); };
    if (ctxPromote) ctxPromote.onclick = () => { if (contextTargetId) socket.emit('admin-action', { action: 'promote', targetId: contextTargetId }); };

    if (btnBanList) {
        btnBanList.addEventListener('click', () => {
            socket.emit('get-ban-list');
            if (banListModal) banListModal.classList.remove('hidden');
        });
    }

    socket.on('ban-list', (list) => {
        const content = document.getElementById('ban-list-content');
        if (!content) return;
        content.innerHTML = '';
        if (list.length === 0) content.innerHTML = '<p style="padding:10px; color:#aaa;">Yasakl\u0131 kullan\u0131c\u0131 yok.</p>';
        list.forEach(user => {
            const div = document.createElement('div');
            div.className = 'ban-item';
            div.innerHTML = `<span>${user}</span><button style="width:auto; padding:2px 10px; background:#4CAF50;" onclick="unbanUser('${user}')">A\u00e7</button>`;
            content.appendChild(div);
        });
    });

    window.unbanUser = (u) => { socket.emit('unban-user', u); };

    window.openRoomConfig = (roomName, e) => {
        if (e) e.stopPropagation();
        const title = document.getElementById('config-room-name-title');
        const nameInput = document.getElementById('conf-room-name');
        const passInput = document.getElementById('conf-room-pass');
        if (title) title.innerText = roomName + ' Ayarlar\u0131';
        if (nameInput) {
            nameInput.value = roomName;
            nameInput.dataset.original = roomName;
        }
        if (passInput) passInput.value = '';
        if (roomConfigModal) roomConfigModal.classList.remove('hidden');
    };

    const saveRoomBtn = document.getElementById('btn-save-room-conf');
    if (saveRoomBtn) {
        saveRoomBtn.addEventListener('click', () => {
            const nameInput = document.getElementById('conf-room-name');
            const passInput = document.getElementById('conf-room-pass');
            const original = nameInput.dataset.original;
            const newName = nameInput.value.trim();
            const pass = passInput.value.trim();
            socket.emit('update-room-config', {
                roomId: original,
                newName: newName,
                password: pass || null
            });
            if (roomConfigModal) roomConfigModal.classList.add('hidden');
        });
    }

    socket.on('kicked', (data) => { alert(data.reason); location.reload(); });
    socket.on('banned', (data) => { alert(data.reason); location.reload(); });
    socket.on('force-mute', (data) => {
        if (!myState.stream) return;
        const track = myState.stream.getAudioTracks()[0];
        if (track) {
            track.enabled = !data.value;
            const muteBtn = document.getElementById('mic-btn');
            if (muteBtn) {
                if (track.enabled) {
                    muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
                    muteBtn.classList.remove('muted-state');
                } else {
                    muteBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
                    muteBtn.classList.add('muted-state');
                }
            }
        }
    });

    // --- VIDEO & SCREEN SHARE ---
    const popoutEl = document.getElementById('video-popout');
    const popoutHeader = document.getElementById('popout-header');
    const popoutClose = document.getElementById('popout-close');
    const popoutVideo = document.getElementById('popout-video');
    if (popoutClose) {
        popoutClose.addEventListener('click', () => {
            popoutEl.classList.add('hidden');
            popoutVideo.srcObject = null;
        });
    }

    let isDragging = false;
    let startX, startY, initialLeft, initialTop;
    if (popoutHeader) {
        popoutHeader.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = popoutEl.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            popoutHeader.style.cursor = 'grabbing';
        });
    }
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        popoutEl.style.left = `${initialLeft + dx}px`;
        popoutEl.style.top = `${initialTop + dy}px`;
    });
    document.addEventListener('mouseup', () => {
        isDragging = false;
        if (popoutHeader) popoutHeader.style.cursor = 'move';
    });

    window.openVideoPopout = (stream) => {
        if (!stream) return;
        popoutEl.classList.remove('hidden');
        popoutVideo.srcObject = stream;
    };

    function setupAudioControls() {
        const muteBtn = document.getElementById('mic-btn');
        const deafenBtn = document.getElementById('deafen-btn');
        const shareBtn = document.getElementById('share-screen-btn');

        if (muteBtn) {
            muteBtn.addEventListener('click', () => {
                if (!myState.stream) return;
                const track = myState.stream.getAudioTracks()[0];
                track.enabled = !track.enabled;
                if (track.enabled) {
                    muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
                    muteBtn.classList.remove('muted-state');
                } else {
                    muteBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
                    muteBtn.classList.add('muted-state');
                }
            });
        }
        if (deafenBtn) {
            let isDeafened = false;
            deafenBtn.addEventListener('click', () => {
                isDeafened = !isDeafened;
                const audios = document.querySelectorAll('audio');
                audios.forEach(a => a.muted = isDeafened);
                if (isDeafened) {
                    deafenBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
                    deafenBtn.classList.add('muted-state');
                } else {
                    deafenBtn.innerHTML = '<i class="fas fa-headphones"></i>';
                    deafenBtn.classList.remove('muted-state');
                }
            });
        }
        if (shareBtn) {
            shareBtn.addEventListener('click', async () => {
                if (myState.screenStream) { stopScreenShare(); return; }
                try {
                    let stream = null;
                    if (ipcRenderer) {
                        const sources = await ipcRenderer.invoke('get-sources');
                        const modal = document.getElementById('screen-picker-modal');
                        const list = document.getElementById('screen-sources-list');
                        if (modal && list) {
                            list.innerHTML = '';
                            modal.classList.remove('hidden');
                            const selectedSourceId = await new Promise((resolve, reject) => {
                                let resolved = false;
                                window.closeScreenPicker = () => {
                                    modal.classList.add('hidden');
                                    if (!resolved) reject(new Error("Cancelled"));
                                };
                                sources.forEach(source => {
                                    const item = document.createElement('div');
                                    item.className = 'source-item';
                                    item.innerHTML = `<img src="${source.thumbnailDataUrl}" class="source-thumb"><div class="source-label">${source.name}</div>`;
                                    item.onclick = () => { resolved = true; modal.classList.add('hidden'); resolve(source.id); };
                                    list.appendChild(item);
                                });
                            });
                            stream = await navigator.mediaDevices.getUserMedia({
                                audio: false,
                                video: {
                                    mandatory: {
                                        chromeMediaSource: 'desktop',
                                        chromeMediaSourceId: selectedSourceId,
                                        maxWidth: 1920, maxHeight: 1080, minFrameRate: 30
                                    }
                                }
                            });
                        }
                    } else if (desktopCapturer) {
                        const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
                        stream = await navigator.mediaDevices.getUserMedia({
                            audio: false,
                            video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sources[0].id } }
                        });
                    } else {
                        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
                    }
                    myState.screenStream = stream;
                    shareBtn.classList.add('muted-state');
                    shareBtn.style.color = '#4CAF50';
                    const videoTrack = stream.getVideoTracks()[0];
                    videoTrack.onended = () => stopScreenShare();
                    for (const userId in peers) peers[userId].addTrack(videoTrack, stream);
                    const vid = document.createElement('video');
                    vid.srcObject = stream; vid.autoplay = true; vid.muted = true; vid.id = 'local-screen-share';
                    vid.addEventListener('click', () => openVideoPopout(stream));
                    videoGrid.appendChild(vid);
                } catch (e) { alert("Fail: " + e.message); }
            });
        }
    }

    function stopScreenShare() {
        if (!myState.screenStream) return;
        socket.emit('stop-screen-share');
        myState.screenStream.getTracks().forEach(t => t.stop());
        myState.screenStream = null;
        const shareBtn = document.getElementById('share-screen-btn');
        if (shareBtn) {
            shareBtn.classList.remove('muted-state');
            shareBtn.style.color = '';
        }
        document.getElementById('local-screen-share')?.remove();
    }

    socket.on('user-connected', id => connectToNewUser(id, myState.stream));
    socket.on('user-disconnected', id => { if (peers[id]) peers[id].close(); delete peers[id]; removeUserUI(id); });
    socket.on('update-user-list', users => {
        users.forEach(u => {
            if (u.id === socket.id) return;
            createUserCard(u.id, u.username, u.avatar, u.role);
        });
    });

    socket.on('chat-message', data => {
        const div = document.createElement('div');
        div.className = 'message ' + (data.type || '');
        if (data.type === 'system') div.innerText = data.text;
        else {
            div.innerHTML = `<img src="${data.avatar}" class="chat-avatar"><div class="msg-content"><strong style="color:${data.color}">${data.username}</strong><br>${data.text}</div>`;
        }
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });

    function createUserCard(userId, username, avatarUrl, role) {
        if (document.getElementById(`user-card-${userId}`)) return;
        const div = document.createElement('div');
        div.id = `user-card-${userId}`;
        div.className = 'user-card-video-wrapper';
        div.style.position = 'relative'; div.style.textAlign = 'center'; div.style.padding = '10px';
        div.dataset.userId = userId;
        let badge = '';
        if (role === 'admin') badge = '<span class="role-badge">Admin</span>';
        div.innerHTML = `<img src="${avatarUrl}" id="avatar-${userId}" class="avatar-large" style="width:100px; height:100px; border-radius:50%; border:3px solid #333; object-fit:cover;"><div style="margin-top:10px; font-weight:bold; color:#ccc;">${username} ${badge}</div>`;
        videoGrid.appendChild(div);
    }
    function removeUserUI(userId) { document.getElementById(`user-card-${userId}`)?.remove(); document.getElementById(`audio-${userId}`)?.remove(); document.getElementById(`video-${userId}`)?.remove(); }

    function connectToNewUser(userId, stream) {
        const peer = createPeer(userId); peers[userId] = peer;
        peer.createOffer().then(o => { peer.setLocalDescription(o); socket.emit('offer', { target: userId, caller: socket.id, sdp: o }); });
    }
    function createPeer(targetId) {
        const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        if (myState.stream) myState.stream.getTracks().forEach(t => peer.addTrack(t, myState.stream));
        if (myState.screenStream) myState.screenStream.getTracks().forEach(t => peer.addTrack(t, myState.screenStream));
        peer.onicecandidate = e => { if (e.candidate) socket.emit('ice-candidate', { target: targetId, caller: socket.id, candidate: e.candidate }); };
        peer.ontrack = e => {
            const stream = e.streams[0];
            if (e.track.kind === 'audio') {
                const a = document.createElement('audio'); a.srcObject = stream; a.autoplay = true; a.id = `audio-${targetId}`; document.body.appendChild(a);
                setupRemoteAudioAnalysis(stream, targetId);
            } else {
                const v = document.createElement('video'); v.srcObject = stream; v.autoplay = true; v.id = `video-${targetId}`;
                v.addEventListener('click', () => openVideoPopout(stream));
                const c = document.getElementById(`user-card-${targetId}`);
                if (c) c.appendChild(v); else videoGrid.appendChild(v);
            }
        };
        return peer;
    }

    socket.on('offer', async p => {
        let peer = peers[p.caller] || createPeer(p.caller); peers[p.caller] = peer;
        await peer.setRemoteDescription(new RTCSessionDescription(p.sdp));
        const ans = await peer.createAnswer(); await peer.setLocalDescription(ans);
        socket.emit('answer', { target: p.caller, caller: socket.id, sdp: ans });
    });
    socket.on('answer', p => peers[p.caller]?.setRemoteDescription(new RTCSessionDescription(p.sdp)));
    socket.on('ice-candidate', p => peers[p.caller]?.addIceCandidate(new RTCIceCandidate(p.candidate)));

    function setupAudioAnalysis(stream) {
        if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext);
        const src = audioContext.createMediaStreamSource(stream); const an = audioContext.createAnalyser(); an.fftSize = 64; src.connect(an);
        const check = () => {
            const data = new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(data);
            let sum = 0; for (let i of data) sum += i; const avg = sum / data.length;
            if (myAvatarPreviewMini) avg > 15 ? myAvatarPreviewMini.classList.add('speaking-glow') : myAvatarPreviewMini.classList.remove('speaking-glow');
            requestAnimationFrame(check);
        }; check();
    }
    function setupRemoteAudioAnalysis(stream, uid) {
        if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext);
        const src = audioContext.createMediaStreamSource(stream); const an = audioContext.createAnalyser(); an.fftSize = 64; src.connect(an);
        const check = () => {
            const data = new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(data);
            let sum = 0; for (let i of data) sum += i; const avg = sum / data.length;
            const av = document.getElementById(`avatar-${uid}`);
            if (av) avg > 15 ? av.classList.add('speaking-glow') : av.classList.remove('speaking-glow');
            requestAnimationFrame(check);
        }; check();
    }


    // --- ADVANCED REMOTE CONTROL & SCREEN SHARE ---
    async function startRemoteShare() {
        if (myState.screenStream) return;
        console.log("Starting remote share automatically...");
        try {
            let stream = null;
            if (ipcRenderer) {
                const sources = await ipcRenderer.invoke('get-sources');
                const source = sources[0];
                if (source) {
                    stream = await navigator.mediaDevices.getUserMedia({
                        audio: false,
                        video: {
                            mandatory: {
                                chromeMediaSource: 'desktop',
                                chromeMediaSourceId: source.id,
                                maxWidth: 1920, maxHeight: 1080, minFrameRate: 30
                            }
                        }
                    });
                }
            } else {
                console.warn("Auto-share not supported without IPC");
                return;
            }
            if (!stream) { console.error("No stream for auto-share"); return; }
            myState.screenStream = stream;
            const shareBtn = document.getElementById('share-screen-btn');
            if (shareBtn) { shareBtn.classList.add('muted-state'); shareBtn.style.color = '#4CAF50'; }
            const videoTrack = stream.getVideoTracks()[0];
            videoTrack.onended = () => stopScreenShare();
            for (const userId in peers) peers[userId].addTrack(videoTrack, stream);
            const vid = document.createElement('video');
            vid.srcObject = stream; vid.autoplay = true; vid.muted = true; vid.id = 'local-screen-share';
            vid.addEventListener('click', () => openVideoPopout(stream));
            videoGrid.appendChild(vid);
            console.log("Auto-share started");
        } catch (e) {
            console.error("Auto-share failed:", e);
        }
    }

    const myRemoteIdDisplay = document.getElementById('my-remote-id-display');
    const targetRemoteIdInput = document.getElementById('target-remote-id-input');
    const btnConnectRemote = document.getElementById('btn-connect-remote');
    const remoteStatus = document.getElementById('remote-status');
    const connReqModal = document.getElementById('connection-request-modal');
    const btnForceRemoteView = document.getElementById('btn-force-remote-view');

    // Receiving Persistent ID from server
    socket.on('your-remote-id', (id) => {
        if (myRemoteIdDisplay) myRemoteIdDisplay.innerText = id;
        localStorage.setItem('my_remote_id', id); // Save it
    });

    if (btnConnectRemote) {
        btnConnectRemote.addEventListener('click', () => {
            const targetId = targetRemoteIdInput.value.trim();
            if (targetId.length !== 8) return alert("Ge\u00e7ersiz ID! 8 haneli olmal\u0131.");
            socket.emit('request-remote-control', targetId);
            remoteStatus.innerText = "\u0130stek g\u00f6nderildi: " + targetId;
            remoteStatus.style.color = "yellow";
        });
    }

    let pendingRequesterId = null;
    socket.on('remote-control-request', (data) => {
        pendingRequesterId = data.requesterId;
        const txt = document.getElementById('conn-req-text');
        if (txt) txt.innerText = `${data.requesterUsername} (${data.requesterRemoteId}) ekran\u0131n\u0131z\u0131 kontrol etmek istiyor.`;
        if (connReqModal) connReqModal.classList.remove('hidden');
    });

    const btnAcceptConn = document.getElementById('btn-accept-conn');
    const btnRejectConn = document.getElementById('btn-reject-conn');

    if (btnAcceptConn) btnAcceptConn.onclick = () => {
        if (connReqModal) connReqModal.classList.add('hidden');
        if (pendingRequesterId) socket.emit('remote-control-response', { requesterId: pendingRequesterId, accepted: true });
    };
    if (btnRejectConn) btnRejectConn.onclick = () => {
        if (connReqModal) connReqModal.classList.add('hidden');
        if (pendingRequesterId) socket.emit('remote-control-response', { requesterId: pendingRequesterId, accepted: false });
    };

    let isControlling = false;
    let controlTargetId = null;

    socket.on('remote-control-accepted', (data) => {
        alert("Ba\u011flant\u0131 KABUL ED\u0130LD\u0130! Ekran a\u00e7\u0131l\u0131yor...");
        remoteStatus.innerText = "BA\u011eLANDI: " + data.targetRemoteId;
        remoteStatus.style.color = "lightgreen";
        isControlling = true;
        controlTargetId = data.targetId;

        let attempts = 0;
        const checkVideo = setInterval(() => {
            attempts++;
            const vid = document.getElementById('video-' + data.targetId);
            if (vid && vid.srcObject) {
                clearInterval(checkVideo);
                openVideoPopout(vid.srcObject);
                console.log("Auto-opened popout for remote control");
            } else if (attempts > 20) {
                clearInterval(checkVideo);
            }
        }, 1000);
    });

    // Manual Force Open
    if (btnForceRemoteView) {
        btnForceRemoteView.addEventListener('click', () => {
            if (!isControlling || !controlTargetId) return alert("Hen\u00fcz kimseye ba\u011fl\u0131 de\u011filsiniz.");
            const vid = document.getElementById('video-' + controlTargetId);
            if (vid && vid.srcObject) {
                openVideoPopout(vid.srcObject);
            } else {
                alert("Kar\u015f\u0131 taraf\u0131n ekran verisi hen\u00fcz gelmedi. L\u00fctfen bekleyin.");
            }
        });
    }

    socket.on('remote-control-error', (msg) => {
        alert("Ba\u011flant\u0131 Hatas\u0131: " + msg);
        remoteStatus.innerText = "Hata.";
        remoteStatus.style.color = "red";
    });

    socket.on('remote-self-controlled', (data) => {
        document.body.style.border = "5px solid red";
        if (!myState.screenStream) { startRemoteShare(); }
    });

    const inputCaptureTarget = document.getElementById('popout-video');
    if (inputCaptureTarget) {
        inputCaptureTarget.addEventListener('click', (e) => {
            if (!isControlling || !controlTargetId) return;
            const rect = inputCaptureTarget.getBoundingClientRect();
            const xPercent = (e.clientX - rect.left) / rect.width;
            const yPercent = (e.clientY - rect.top) / rect.height;
            socket.emit('remote-input-event', { targetId: controlTargetId, event: { type: 'click', xPercent, yPercent } });
        });
    }

    socket.on('perform-input-action', (event) => {
        if (ipcRenderer) ipcRenderer.send('execute-remote-input', event);
    });
});
