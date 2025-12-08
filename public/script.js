// Desktop App Config
let socket;
const myPeer = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
});

// State
let myStream;
let myScreenStream;
let myUsername = '';
let myColor = '#ffffff';
let currentRoom = '';
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
        socket = io(url);
    } catch (e) {
        alert("Bağlantı hatası: " + e.message);
        return;
    }

    myUsername = user;
    myColor = getRandomColor();

    // Request Notification Permission
    Notification.requestPermission();

    socket.on('connect', () => {
        loginScreen.classList.add('hidden');
        lobbyScreen.classList.remove('hidden');
    });

    socket.on('connect_error', (err) => {
        console.error("Connect error", err);
    });

    setupSocketEvents();
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
            // Stop Sharing
            stopScreenShare();
            return;
        }

        try {
            // Use standard Web API for screen sharing
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: false
            });

            myScreenStream = stream;
            shareScreenBtn.innerText = 'Paylaşımı Durdur';
            shareScreenBtn.classList.add('sharing');

            // Add video track to local video grid (preview)
            addVideoStream(stream, null, true);

            // Add track to all peers
            const videoTrack = stream.getVideoTracks()[0];

            // Handle user stopping share via OS floating bar
            videoTrack.onended = () => stopScreenShare();

            for (const userId in peers) {
                const peer = peers[userId];
                // Add track to peer
                peer.addTrack(videoTrack, stream);
            }

        } catch (e) {
            console.error(e);
            alert('Ekran paylaşımı başlatılamadı: ' + e.message);
        }
    });
}

function stopScreenShare() {
    if (!myScreenStream) return;

    myScreenStream.getTracks().forEach(track => track.stop());
    myScreenStream = null;

    shareScreenBtn.innerText = 'Ekran Paylaş';
    shareScreenBtn.classList.remove('sharing');

    // Remove local preview
    const localVideo = document.getElementById('local-video-preview');
    if (localVideo) localVideo.remove();
}

function addVideoStream(stream, userId, isLocal = false) {
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
    socket.on('update-user-list', (users) => {
        userList.innerHTML = '';
        users.forEach(u => {
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.flexDirection = 'column';
            li.style.marginBottom = '10px';
            li.style.padding = '8px';
            li.style.borderBottom = '1px solid #333';

            // User Info Row
            const infoRow = document.createElement('div');
            const span = document.createElement('span');

            let displayName = u.username;
            let displayColor = u.color || '#fff';

            if (typeof displayName === 'object' && displayName !== null) {
                displayColor = displayName.color || displayColor;
                displayName = displayName.username || 'Bilinmeyen';
            }

            span.style.color = displayColor;
            span.innerText = displayName + (u.id === socket.id ? ' (Sen)' : '');
            infoRow.appendChild(span);
            li.appendChild(infoRow);

            // Volume Slider (only for others)
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
    // Note: If screen sharing started BEFORE this user joined, we should add that track too.
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
            let video = document.getElementById(`video-${targetId}`);
            if (!video) {
                video = document.createElement('video');
                video.id = `video-${targetId}`;
                video.autoplay = true;
                videoGrid.appendChild(video);
            }
            video.srcObject = stream;
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
    // Negotiation needed will fire if tracks added
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
