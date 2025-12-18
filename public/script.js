document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Loaded, Initializing App...");

    // --- CLICK DEBUGGER (Temporary) ---
    document.addEventListener('click', (e) => {
        console.log('Clicked Element:', e.target, 'Classes:', e.target.className);
    });

    // --- CONFIG & STATE ---
    const socket = io('https://voiceapp-ecxg.onrender.com/', {
        transports: ['websocket'],
        reconnectionAttempts: 10
    });

    // We keep global state to handle context menus
    let myState = {
        username: localStorage.getItem('chat_username') || '',
        avatar: localStorage.getItem('chat_avatar') || 'https://cdn-icons-png.flaticon.com/512/847/847969.png',
        color: localStorage.getItem('chat_color') || getRandomColor(),
        adminKey: '',  // Entered in login
        role: 'user',  // Standard user default
        room: null,
        stream: null,
        screenStream: null
    };

    // ... Imports ...
    const myPeer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    let ipcRenderer, desktopCapturer;
    try {
        const electron = require('electron');
        ipcRenderer = electron.ipcRenderer;
        desktopCapturer = electron.desktopCapturer;
    } catch (e) {
        console.warn("Electron module not found");
    }

    let peers = {};
    let audioContext;
    let roomConfigs = {}; // Store { roomName: {password: string|null} }

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

    // Admin Elements
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

    function getRandomColor() {
        const letters = '89ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) color += letters[Math.floor(Math.random() * 16)];
        return color;
    }

    // --- 1. LOGIN ---
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
            console.log("Login btn clicked");
            const user = usernameInput.value.trim();
            if (!user) return alert("Kullanıcı adı gerekli");

            myState.username = user;
            myState.adminKey = adminKeyInput.value.trim();
            if (avatarPreview.src) myState.avatar = avatarPreview.src;

            localStorage.setItem('chat_username', myState.username);
            localStorage.setItem('chat_avatar', myState.avatar);
            localStorage.setItem('chat_color', myState.color);

            // EMIT LOGIN
            socket.emit('login', {
                username: myState.username,
                avatar: myState.avatar,
                adminKey: myState.adminKey
            });

            try {
                myState.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                setupAudioControls();
                setupAudioAnalysis(myState.stream);
            } catch (e) {
                console.error(e);
                alert("Mikrofon hatası (ancak giriş yapılıyor): " + e.message);
            }
        });
    }

    socket.on('login-success', (data) => {
        myState.role = data.role;
        console.log("Logged in as:", myState.role);

        // UI Updates
        if (loginOverlay) loginOverlay.classList.add('hidden');
        if (myAvatarPreviewMini) {
            myAvatarPreviewMini.src = myState.avatar;
            myAvatarPreviewMini.classList.remove('hidden');
        }
        if (myUsernameDisplay) {
            myUsernameDisplay.innerText = myState.username;
            myUsernameDisplay.style.color = myState.color;
        }

        // Reset Admin UI First
        const roleBadge = document.getElementById('my-role-badge');
        if (roleBadge) roleBadge.style.display = 'none';
        if (btnBanList) btnBanList.classList.add('hidden');

        if (myState.role === 'admin') {
            if (roleBadge) roleBadge.style.display = 'inline';
            if (btnBanList) btnBanList.classList.remove('hidden');
        }

        // Force Fetch Rooms
        console.log("Login success, fetching rooms explicitly...");
        socket.emit('get-rooms');
    });


    // --- 2. ROOM & ADMIN LOGIC ---

    // Room Configs Update
    socket.on('room-config-update', (configs) => {
        console.log("Room configs updated");
        roomConfigs = configs;
    });

    // Room List Update - REFACOR to DOM API for Safety
    socket.on('room-list-update', (roomState) => {
        console.log("Room list received:", roomState);
        try {
            if (roomListContainer) {
                roomListContainer.innerHTML = '';
                if (!roomState || Object.keys(roomState).length === 0) {
                    roomListContainer.innerHTML = '<div style="padding:10px; color:#666;">Oda listesi boş veya yükleniyor...</div>';
                    return;
                }

                for (const [roomName, usersInRoom] of Object.entries(roomState)) {
                    const div = document.createElement('div');
                    div.className = 'room-item';

                    // 1. Check Active Status
                    const amIHere = Array.isArray(usersInRoom) && usersInRoom.some(u => u.id === socket.id);
                    if (amIHere) {
                        div.classList.add('active');
                        myState.room = roomName;
                    }

                    // 2. Build Title Row (Name + Lock + Settings)
                    const titleRow = document.createElement('div');
                    titleRow.className = 'room-name';
                    titleRow.style.display = 'flex';
                    titleRow.style.justifyContent = 'space-between';
                    titleRow.style.alignItems = 'center';

                    const nameSpan = document.createElement('span');
                    // Check Lock
                    let lockedIcon = '';
                    if (roomConfigs[roomName]?.password) lockedIcon = ' 🔒';
                    nameSpan.innerText = roomName + lockedIcon;
                    titleRow.appendChild(nameSpan);

                    // Check Admin Settings
                    if (myState.role === 'admin') {
                        const settingsBtn = document.createElement('span');
                        settingsBtn.innerText = '⚙️';
                        settingsBtn.style.cursor = 'pointer';
                        settingsBtn.style.padding = '0 5px';
                        settingsBtn.title = "Oda Ayarları";

                        // CRITICALLY IMPORTANT: Explicit Listener
                        settingsBtn.onclick = (e) => {
                            e.stopPropagation(); // Stop bubbling to room join
                            console.log("Settings clicked for", roomName);
                            openRoomConfig(roomName, e);
                        };
                        titleRow.appendChild(settingsBtn);
                    }
                    div.appendChild(titleRow);

                    // 3. Build Avatars (Vertical List)
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

                    // 4. Main Click -> Join
                    div.onclick = (e) => {
                        console.log("Room Item clicked:", roomName);
                        joinRoom(roomName);
                    };

                    roomListContainer.appendChild(div);
                }
            }
        } catch (e) {
            console.error("Room Render Error:", e);
            if (roomListContainer) roomListContainer.innerHTML = '<div style="color:red;">Liste hatası! Lütfen yenileyin.</div>';
        }
    });

    let pendingRoom = null;
    async function joinRoom(roomName, password = null) {
        if (myState.room === roomName && !password) return;

        pendingRoom = roomName; // For password retry

        // Clean UI if switching
        if (myState.room && myState.room !== roomName) {
            if (activeRoomView) activeRoomView.classList.add('hidden');
            if (videoGrid) videoGrid.innerHTML = '';
            if (chatMessages) chatMessages.innerHTML = '';
            // Close peers
            Object.values(peers).forEach(p => p.close());
            peers = {};
            document.querySelectorAll('audio').forEach(a => a.remove());
        }

        const title = document.getElementById('current-room-title');
        if (title) title.innerText = roomName;

        // Join
        console.log("Emitting join-room:", roomName);
        socket.emit('join-room', roomName, {
            username: myState.username,
            avatar: myState.avatar,
            color: myState.color,
            adminKey: myState.adminKey,
            password: password
        });
    }

    // Password Required
    socket.on('password-required', (data) => {
        // If we already sent a password (and it was wrong), pendingRoom might still be set
        // Ideally we show "Wrong Password"
        if (pendingRoom === data.roomId && document.getElementById('room-pass-input').value !== '') {
            alert("Hatalı Şifre!");
            document.getElementById('room-pass-input').value = '';
        }

        pendingRoom = data.roomId;
        if (passwordModal) passwordModal.classList.remove('hidden');
    });

    const submitPassBtn = document.getElementById('btn-submit-pass');
    if (submitPassBtn) {
        submitPassBtn.addEventListener('click', () => {
            const pass = document.getElementById('room-pass-input').value;
            if (passwordModal) passwordModal.classList.add('hidden'); // Hide momentarily, will reappear if wrong
            if (pendingRoom && pass) {
                joinRoom(pendingRoom, pass);
            }
        });
    }

    // CHAT FORM FIX
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

    // Join Success & Role Assignment
    socket.on('joined-success', (data) => {
        console.log("Joined success:", data);
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
            alert("Yönetici yetkisi verildi!");
            // Refresh room list to show settings icons
            socket.emit('get-rooms');
        }
    });


    // --- 3. CONTEXT MENU LITERALLY EVERYWHERE ---

    let contextTargetId = null;

    document.addEventListener('contextmenu', (e) => {
        // Only if admin
        if (myState.role !== 'admin') return;

        const target = e.target.closest('.user-card-video-wrapper') || e.target.closest('.message');
        // We need to associate ID with elements carefully.
        // User cards have ID: `user-card-${userId}`
        // Chat messages don't have ID easily visible unless we added it.
        // Let's rely on User Cards in the grid/sidebar mostly or add data-id to everything.

        let userId = null;

        // Check Video Grid
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

    // Hide context menu on click
    document.addEventListener('click', () => {
        if (contextMenu) contextMenu.classList.add('hidden');
    });

    // Context Actions
    const ctxKick = document.getElementById('ctx-kick');
    const ctxBan = document.getElementById('ctx-ban');
    const ctxMute = document.getElementById('ctx-mute');
    const ctxPromote = document.getElementById('ctx-promote');

    if (ctxKick) ctxKick.onclick = () => {
        if (contextTargetId) socket.emit('admin-action', { action: 'kick', targetId: contextTargetId });
    };
    if (ctxBan) ctxBan.onclick = () => {
        if (contextTargetId) socket.emit('admin-action', { action: 'ban', targetId: contextTargetId });
    };
    if (ctxMute) ctxMute.onclick = () => {
        if (contextTargetId) socket.emit('admin-action', { action: 'mute', targetId: contextTargetId });
    };
    if (ctxPromote) ctxPromote.onclick = () => {
        if (contextTargetId) socket.emit('admin-action', { action: 'promote', targetId: contextTargetId });
    };


    // --- 4. ADMIN FEATURES (BAN LIST & ROOM CONFIG) ---

    // Ban List
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

        if (list.length === 0) content.innerHTML = '<p style="padding:10px; color:#aaa;">Yasaklı kullanıcı yok.</p>';

        list.forEach(user => {
            const div = document.createElement('div');
            div.className = 'ban-item';
            div.innerHTML = `
                <span>${user}</span>
                <button style="width:auto; padding:2px 10px; background:#4CAF50;" onclick="unbanUser('${user}')">Aç</button>
            `;
            content.appendChild(div);
        });
    });

    window.unbanUser = (u) => {
        socket.emit('unban-user', u);
    };

    // Room Config
    window.openRoomConfig = (roomName, e) => {
        if (e) e.stopPropagation();
        const title = document.getElementById('config-room-name-title');
        const nameInput = document.getElementById('conf-room-name');
        const passInput = document.getElementById('conf-room-pass');

        if (title) title.innerText = roomName + ' Ayarları';
        if (nameInput) {
            nameInput.value = roomName;
            // Store original name to know what to update
            nameInput.dataset.original = roomName;
        }
        if (passInput) passInput.value = ''; // Don't show old pass

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
                password: pass || null // Empty string -> null (remove pass)
            });

            if (roomConfigModal) roomConfigModal.classList.add('hidden');
        });
    }


    // --- 5. EVENTS (Kicked, Banned, Muted) ---

    socket.on('kicked', (data) => {
        alert(data.reason);
        location.reload();
    });

    socket.on('banned', (data) => {
        alert(data.reason);
        location.reload();
    });

    socket.on('force-mute', (data) => {
        // data.value = true (mute) or false (unmute)
        if (!myState.stream) return;
        const track = myState.stream.getAudioTracks()[0];
        if (track) {
            track.enabled = !data.value; // If mute=true, enabled=false

            // Update UI
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


    // --- 6. STANDARD STUFF (Chat, WebRTC) ---
    function setupAudioControls() {
        const muteBtn = document.getElementById('mic-btn');
        const deafenBtn = document.getElementById('deafen-btn');
        const shareBtn = document.getElementById('share-screen-btn');

        // MIC TOGGLE
        if (muteBtn) {
            muteBtn.addEventListener('click', () => {
                if (!myState.stream) return;
                const track = myState.stream.getAudioTracks()[0];
                track.enabled = !track.enabled;
                if (track.enabled) {
                    // Unmuted
                    muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
                    muteBtn.classList.remove('muted-state');
                    muteBtn.title = "Mikrofon Açık";
                } else {
                    // Muted
                    muteBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
                    muteBtn.classList.add('muted-state');
                    muteBtn.title = "Mikrofon Kapalı";
                }
            });
        }

        // DEAFEN TOGGLE (New)
        if (deafenBtn) {
            let isDeafened = false;
            deafenBtn.addEventListener('click', () => {
                isDeafened = !isDeafened;
                const audios = document.querySelectorAll('audio');
                audios.forEach(a => a.muted = isDeafened);

                if (isDeafened) {
                    deafenBtn.innerHTML = '<i class="fas fa-volume-mute"></i>'; // or headphones-slash
                    deafenBtn.classList.add('muted-state');
                    deafenBtn.title = "Ses Kapalı";
                } else {
                    deafenBtn.innerHTML = '<i class="fas fa-headphones"></i>';
                    deafenBtn.classList.remove('muted-state');
                    deafenBtn.title = "Ses Açık";
                }
            });
        }

        // SCREEN SHARE
        if (shareBtn) {
            shareBtn.addEventListener('click', async () => {
                if (myState.screenStream) { stopScreenShare(); return; }
                try {
                    let stream = null;
                    if (desktopCapturer) {
                        const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
                        const source = sources[0];
                        stream = await navigator.mediaDevices.getUserMedia({
                            audio: false,
                            video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source.id } }
                        });
                    } else {
                        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
                    }
                    myState.screenStream = stream;

                    shareBtn.classList.add('muted-state'); // Reuse muted-state for active indication red? Or green?
                    shareBtn.style.color = '#4CAF50'; // Active Color

                    const videoTrack = stream.getVideoTracks()[0];
                    videoTrack.onended = () => stopScreenShare();
                    for (const userId in peers) peers[userId].addTrack(videoTrack, stream);

                    const vid = document.createElement('video');
                    vid.srcObject = stream; vid.autoplay = true; vid.muted = true; vid.id = 'local-screen-share';
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
            shareBtn.style.color = ''; // Reset
        }

        document.getElementById('local-screen-share')?.remove();
    }

    // ... Listeners for user-connected, disconnected, update-user-list (Same as before) ...
    socket.on('user-connected', id => connectToNewUser(id, myState.stream));
    socket.on('user-disconnected', id => { if (peers[id]) peers[id].close(); delete peers[id]; removeUserUI(id); });
    socket.on('update-user-list', users => {
        users.forEach(u => {
            if (u.id === socket.id) return;
            createUserCard(u.id, u.username, u.avatar, u.role);
        });
    });
    socket.on('chat-message', data => {
        // ... same chat logic ...
        const div = document.createElement('div');
        div.className = 'message ' + (data.type || '');
        if (data.type === 'system') div.innerText = data.text;
        else {
            // ... msg content ...
            div.innerHTML = `<img src="${data.avatar}" class="chat-avatar"><div class="msg-content"><strong style="color:${data.color}">${data.username}</strong><br>${data.text}</div>`;
        }
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });

    // ... WebRTC Helpers (createPeer, connectToNewUser, etc) ... 
    // Assuming mostly identical to previous step, just reusing 'myState'
    // Added 'role' handling in createUserCard to show badge?
    function createUserCard(userId, username, avatarUrl, role) {
        if (document.getElementById(`user-card-${userId}`)) return;
        const div = document.createElement('div');
        div.id = `user-card-${userId}`;
        div.className = 'user-card-video-wrapper';
        div.style.position = 'relative'; div.style.textAlign = 'center'; div.style.padding = '10px';

        // Add user ID to dataset for context menu!
        div.dataset.userId = userId;

        let badge = '';
        if (role === 'admin') badge = '<span class="role-badge">Admin</span>';

        div.innerHTML = `
            <img src="${avatarUrl}" id="avatar-${userId}" class="avatar-large" style="width:100px; height:100px; border-radius:50%; border:3px solid #333; object-fit:cover;">
            <div style="margin-top:10px; font-weight:bold; color:#ccc;">${username} ${badge}</div>
        `;
        videoGrid.appendChild(div);
    }
    // Remove UI helper
    function removeUserUI(userId) { document.getElementById(`user-card-${userId}`)?.remove(); document.getElementById(`audio-${userId}`)?.remove(); document.getElementById(`video-${userId}`)?.remove(); }
    // Connect Helper
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
                const c = document.getElementById(`user-card-${targetId}`);
                if (c) c.appendChild(v); else videoGrid.appendChild(v);
            }
        };
        return peer;
    }
    // Listeners for offer/answer/ice... (Standard)
    socket.on('offer', async p => {
        let peer = peers[p.caller] || createPeer(p.caller); peers[p.caller] = peer;
        await peer.setRemoteDescription(new RTCSessionDescription(p.sdp));
        const ans = await peer.createAnswer(); await peer.setLocalDescription(ans);
        socket.emit('answer', { target: p.caller, caller: socket.id, sdp: ans });
    });
    socket.on('answer', p => peers[p.caller]?.setRemoteDescription(new RTCSessionDescription(p.sdp)));
    socket.on('ice-candidate', p => peers[p.caller]?.addIceCandidate(new RTCIceCandidate(p.candidate)));

    // Audio Analysis (Iris) RE-INCLUDED
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
});
