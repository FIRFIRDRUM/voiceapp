// Desktop App Config
let socket;
const myPeer = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
});

// Import Electron modules safely
let desktopCapturer;
let ipcRenderer;
try {
    // Try standard require first (Node integration)
    const electron = require('electron');
    desktopCapturer = electron.desktopCapturer;
    ipcRenderer = electron.ipcRenderer;
} catch (e) {
    try {
        // Try window.require (Context Isolation fallback)
        const electron = window.require('electron');
        desktopCapturer = electron.desktopCapturer;
        ipcRenderer = electron.ipcRenderer;
    } catch (e2) {
        console.warn("Electron modules not found. Running in browser mode?", e2);
    }
}

// State
let myStream;
let myScreenStream;
let myUsername = '';
let myColor = '#ffffff';
let currentRoom = '';
let isConnected = false; // Track connection state
const peers = {}; // userId -> PeerConnection
const userVolumes = {}; // userId -> volume (0-1)

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const roomScreen = document.getElementById('room-screen');
const usernameInput = document.getElementById('username-input');
const loginBtn = document.getElementById('login-btn');
const roomBtns = document.querySelectorAll('.room-btn');
const currentRoomName = document.getElementById('current-room-name');
const leaveBtn = document.getElementById('leave-btn');
const userList = document.getElementById('user-list');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const msgInput = document.getElementById('msg-input');
const muteBtn = document.getElementById('mute-btn');
const shareScreenBtn = document.getElementById('share-screen-btn');
const videoGrid = document.getElementById('video-grid');
const sourceModal = document.getElementById('source-modal');
const sourceGrid = document.getElementById('source-grid');


function getRandomColor() {
    const letters = '89ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

function showNotification(title, body) {
    if (Notification.permission === 'granted') {
        new Notification(title, { body });
    }
}

// --- 1. LOGIN ---
loginBtn.addEventListener('click', () => {
    const user = usernameInput.value.trim();
    // HARDCODED SERVER URL
    const url = 'https://voiceapp-ecxg.onrender.com/';

    if (!user) return alert('Lütfen kullanıcı adı girin');

    try {
        if (!socket) {
            socket = io(url);
            setupSocketEvents();
        } else if (!socket.connected) {
            socket.connect();
        }
    } catch (e) {
        alert("Bağlantı hatası: " + e.message);
        return;
    }

    myUsername = user;
    if (!myColor || myColor === '#ffffff') myColor = getRandomColor();

    // Request Notification Permission
    Notification.requestPermission();
});


// --- 2. JOIN ROOM ---
roomBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
        const room = btn.dataset.room;
        await joinRoom(room);
    });
});

async function joinRoom(room) {
    currentRoom = room;

    try {
        if (!myStream) {
            myStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        }
    } catch (e) {
        alert('Mikrofon izni gerek: ' + e.message);
        return;
    }

    lobbyScreen.classList.add('hidden');
    roomScreen.classList.remove('hidden');
    currentRoomName.innerText = room.toUpperCase();

    // Pass color here
    socket.emit('join-room', room, { username: myUsername, color: myColor });
}

// --- 3. LEAVE ROOM ---
leaveBtn.addEventListener('click', () => {
    // Reload acts as a full reset
    location.reload();
});

// --- 4. CHAT ---
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = msgInput.value.trim();
    if (text) {
        socket.emit('send-chat-message', text);
        msgInput.value = '';
    }
});

function addMessage(username, text, type = 'user', color = '#fff') {
    const div = document.createElement('div');
    div.classList.add('message');
    if (type === 'system') div.classList.add('system');

    if (type === 'user') {
        const nameSpan = document.createElement('strong');
        nameSpan.style.color = color;
        nameSpan.innerText = username + ': ';
        div.appendChild(nameSpan);
        div.appendChild(document.createTextNode(text));

        // Notification
        if (username !== myUsername) {
            showNotification(username, text);
        }
    } else {
        div.innerText = text;
    }

    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// --- 5. CONTROLS ---
muteBtn.addEventListener('click', () => {
    if (!myStream) return;
    const track = myStream.getAudioTracks()[0];
    track.enabled = !track.enabled;
    muteBtn.innerText = track.enabled ? 'Mikrofon Açık' : 'Mikrofon Kapalı';
    muteBtn.classList.toggle('muted', !track.enabled);
});

if (shareScreenBtn) {
    shareScreenBtn.addEventListener('click', async () => {
        if (myScreenStream) {
            stopScreenShare();
            return;
        }

        // Try standard API first (Browser)
        if (!desktopCapturer) {
            try {
                const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
                startScreenShareFromStream(stream);
                return;
            } catch (e) {
                // Ignore, try electron way or alert
                alert("Web Ekran Paylaşımı Başarısız: " + e.message + "\nElectron paylaşımı deneniyor...");
            }
        }

        // Try Electron Way
        if (desktopCapturer) {
            try {
                const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
                sourceGrid.innerHTML = '';
                sources.forEach(source => {
                    const div = document.createElement('div');
                    div.classList.add('source-item');
                    div.innerHTML = `<img src="${source.thumbnail.toDataURL()}" /><p>${source.name}</p>`;
                    div.onclick = async () => {
                        sourceModal.classList.add('hidden');
                        try {
                            const stream = await navigator.mediaDevices.getUserMedia({
                                audio: false,
                                video: {
                                    mandatory: {
                                        chromeMediaSource: 'desktop',
                                        chromeMediaSourceId: source.id
                                    }
                                }
                            });
                            startScreenShareFromStream(stream);
                        } catch (err) {
                            alert("Electron stream hatası: " + err.message);
                        }
                    };
                    sourceGrid.appendChild(div);
                });
                sourceModal.classList.remove('hidden');
            } catch (e) {
                alert("Electron Source Hatası: " + e.message);
            }
        } else {
            alert("Ekran paylaşımı için uygun yöntem bulunamadı.");
        }
    });
}

function startScreenShareFromStream(stream) {
    myScreenStream = stream;
    shareScreenBtn.innerText = 'Paylaşımı Durdur';
    shareScreenBtn.classList.add('sharing');

    // Local Preview
    addVideoStream(stream, null, true);

    const videoTrack = stream.getVideoTracks()[0];
    videoTrack.onended = () => stopScreenShare();

    // Send to peers
    for (const userId in peers) {
        const peer = peers[userId];
        peer.addTrack(videoTrack, stream);
    }
}

function stopScreenShare() {
    if (!myScreenStream) return;

    // 1. Tell Server
    socket.emit('stop-screen-share');

    // 2. Stop Tracks
    myScreenStream.getTracks().forEach(track => track.stop());
    myScreenStream = null;

    shareScreenBtn.innerText = 'Ekran Paylaş';
    shareScreenBtn.classList.remove('sharing');

    // 3. Remove Local Preview
    const localVideo = document.getElementById('local-video-preview');
    if (localVideo) localVideo.remove();
}

function addVideoStream(stream, userId, isLocal = false) {
    // Avoid Duplicates
    if (!isLocal && document.getElementById(`video-${userId}`)) return;
    if (isLocal && document.getElementById('local-video-preview')) return;

    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    if (isLocal) {
        video.muted = true;
        video.id = 'local-video-preview';
    } else {
        video.id = `video-${userId}`;
    }
    videoGrid.appendChild(video);
}

// --- SOCKET EVENTS ---
function setupSocketEvents() {
    socket.on('connect', () => {
        isConnected = true;
        // Only show lobby if we are NOT in a room (First login)
        // If we are in a room and reconnecting, we should probably re-join or stay silent?
        // Ideally we re-join. For now, let's just NOT jump to lobby if room is set.
        if (!currentRoom) {
            loginScreen.classList.add('hidden');
            lobbyScreen.classList.remove('hidden');
        } else {
            console.log("Reconnected to socket while in room");
            // If the socket ID changed, we effectively left the room on the server.
            // We must re-join.
            socket.emit('join-room', currentRoom, { username: myUsername, color: myColor });
        }
    });

    socket.on('disconnect', () => {
        isConnected = false;
        console.log("Disconnected...");
        showNotification("Bağlantı Koptu", "Yeniden bağlanılıyor...");
    });

    socket.on('update-user-list', (users) => {
        userList.innerHTML = '';
        users.forEach(u => {
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.flexDirection = 'column';
            li.style.marginBottom = '10px';
            li.style.padding = '8px';
            li.style.borderBottom = '1px solid #333';

            // User Info
            const infoRow = document.createElement('div');
            const span = document.createElement('span');

            let displayName = u.username;
            let displayColor = u.color || '#fff';

            // Compatibility Check
            if (typeof displayName === 'object' && displayName !== null) {
                displayColor = displayName.color || displayColor;
                displayName = displayName.username || 'Bilinmeyen';
            }

            span.style.color = displayColor;
            span.innerText = displayName + (u.id === socket.id ? ' (Sen)' : '');
            infoRow.appendChild(span);
            li.appendChild(infoRow);

            // Volume Slider
            if (u.id !== socket.id) {
                const sliderDiv = document.createElement('div');
                sliderDiv.className = 'volume-control';

                const slider = document.createElement('input');
                slider.type = 'range';
                slider.min = '0';
                slider.max = '1';
                slider.step = '0.05';
                slider.value = userVolumes[u.id] !== undefined ? userVolumes[u.id] : 1;

                slider.oninput = (e) => {
                    const vol = e.target.value;
                    userVolumes[u.id] = vol;
                    const audio = document.getElementById(`audio-${u.id}`);
                    if (audio) audio.volume = vol;
                };

                const label = document.createElement('span');
                label.innerText = '🔊';
                label.style.fontSize = '0.8rem';

                sliderDiv.appendChild(label);
                sliderDiv.appendChild(slider);
                li.appendChild(sliderDiv);
            }

            userList.appendChild(li);
        });
    });

    socket.on('chat-message', (data) => {
        let username = data.username;
        let color = data.color || '#fff';
        if (typeof username === 'object' && username !== null) {
            color = username.color || color;
            username = username.username || 'Bilinmeyen';
        }
        addMessage(username, data.text, data.type, color);
    });

    socket.on('user-connected', (userId) => {
        connectToNewUser(userId, myStream);
        showNotification('Yeni Kullanıcı', 'Odaya biri katıldı');
    });

    socket.on('user-disconnected', (userId) => {
        if (peers[userId]) peers[userId].close();
        delete peers[userId];

        const audio = document.getElementById(`audio-${userId}`);
        if (audio) audio.remove();

        const video = document.getElementById(`video-${userId}`);
        if (video) video.remove();
    });

    // NEW: Handle stop screen share signal
    socket.on('user-stopped-screen-share', (userId) => {
        const video = document.getElementById(`video-${userId}`);
        if (video) video.remove();
    });

    socket.on('offer', async (payload) => {
        // If we already have a peer, we might be renegotiating (screen share)
        let peer = peers[payload.caller];
        if (!peer) {
            peer = createPeer(payload.caller);
            peers[payload.caller] = peer;
        }

        await peer.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit('answer', { target: payload.caller, caller: socket.id, sdp: answer });
    });

    socket.on('answer', (payload) => {
        if (peers[payload.caller]) {
            peers[payload.caller].setRemoteDescription(new RTCSessionDescription(payload.sdp));
        }
    });

    socket.on('ice-candidate', (payload) => {
        if (peers[payload.caller]) {
            peers[payload.caller].addIceCandidate(new RTCIceCandidate(payload.candidate));
        }
    });
}

// --- WebRTC Helpers ---

function createPeer(targetId) {
    const peer = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    if (myStream) {
        myStream.getTracks().forEach(track => peer.addTrack(track, myStream));
    }
    if (myScreenStream) {
        myScreenStream.getTracks().forEach(track => peer.addTrack(track, myScreenStream));
    }

    peer.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('ice-candidate', { target: targetId, caller: socket.id, candidate: event.candidate });
        }
    };

    peer.ontrack = event => {
        const stream = event.streams[0];
        const track = event.track;

        if (track.kind === 'audio') {
            const audio = document.createElement('audio');
            audio.srcObject = stream;
            audio.autoplay = true;
            audio.id = `audio-${targetId}`;
            if (userVolumes[targetId] !== undefined) {
                audio.volume = userVolumes[targetId];
            }
            document.body.appendChild(audio);
        } else if (track.kind === 'video') {
            addVideoStream(stream, targetId);
        }
    };

    peer.onnegotiationneeded = async () => {
        try {
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            socket.emit('offer', { target: targetId, caller: socket.id, sdp: offer });
        } catch (err) {
            console.error('Negotiation error', err);
        }
    };

    return peer;
}

function connectToNewUser(userId, stream) {
    const peer = createPeer(userId);
    peers[userId] = peer;
    if (stream) {
        peer.createOffer().then(offer => {
            peer.setLocalDescription(offer);
            socket.emit('offer', { target: userId, caller: socket.id, sdp: offer });
        });
    } else {
        peer.createOffer().then(offer => {
            peer.setLocalDescription(offer);
            socket.emit('offer', { target: userId, caller: socket.id, sdp: offer });
        });
    }
}
