const socket = io('/');
const myPeer = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
});

// State
let myStream;
let myUsername = '';
let currentRoom = '';
const peers = {};

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

// --- 1. LOGIN ---
loginBtn.addEventListener('click', () => {
    const user = usernameInput.value.trim();
    if (!user) return alert('Lütfen kullanıcı adı girin');

    myUsername = user;
    loginScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
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

    // Get Audio
    try {
        if (!myStream) {
            myStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        }
    } catch (e) {
        alert('Mikrofon izni gerek: ' + e.message);
        return;
    }

    // Switch UI
    lobbyScreen.classList.add('hidden');
    roomScreen.classList.remove('hidden');
    currentRoomName.innerText = room.toUpperCase();

    // Emit Join
    socket.emit('join-room', room, myUsername);
}

// --- 3. LEAVE ROOM ---
leaveBtn.addEventListener('click', () => {
    location.reload(); // Simple reload to reset everything
});

// --- 4. CHAT ---
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = msgInput.value.trim();
    if (text) {
        socket.emit('send-chat-message', text); // Send to server
        msgInput.value = '';
    }
});

function addMessage(username, text, type = 'user') {
    const div = document.createElement('div');
    div.classList.add('message');
    if (type === 'system') div.classList.add('system');

    if (type === 'user') {
        div.innerHTML = `<strong>${username}:</strong> ${text}`;
    } else {
        div.innerText = text;
    }

    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// --- 5. CONTROLS ---
muteBtn.addEventListener('click', () => {
    const track = myStream.getAudioTracks()[0];
    track.enabled = !track.enabled;
    if (track.enabled) {
        muteBtn.innerText = 'Mikrofon Açık';
        muteBtn.classList.remove('muted');
    } else {
        muteBtn.innerText = 'Mikrofon Kapalı';
        muteBtn.classList.add('muted');
    }
});


// --- SOCKET EVENTS ---

socket.on('update-user-list', (users) => {
    userList.innerHTML = '';
    users.forEach(u => {
        const li = document.createElement('li');
        li.innerText = u.username + (u.id === socket.id ? ' (Sen)' : '');
        userList.appendChild(li);
    });
});

socket.on('chat-message', (data) => {
    addMessage(data.username, data.text, data.type);
});

socket.on('user-connected', (userId) => {
    // New user joined, initiate call
    connectToNewUser(userId, myStream);
});

socket.on('user-disconnected', (userId) => {
    if (peers[userId]) peers[userId].close();
    delete peers[userId];
});

socket.on('offer', async (payload) => {
    const peer = createPeer(payload.caller);
    peers[payload.caller] = peer;
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

// --- WebRTC Helpers ---

function createPeer(targetId) {
    const peer = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    myStream.getTracks().forEach(track => peer.addTrack(track, myStream));

    peer.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('ice-candidate', { target: targetId, caller: socket.id, candidate: event.candidate });
        }
    };

    peer.ontrack = event => {
        const audio = document.createElement('audio');
        audio.srcObject = event.streams[0];
        audio.autoplay = true;
        document.body.appendChild(audio);
    };

    return peer;
}

function connectToNewUser(userId, stream) {
    const peer = createPeer(userId);
    peers[userId] = peer;
    peer.createOffer().then(offer => {
        peer.setLocalDescription(offer);
        socket.emit('offer', { target: userId, caller: socket.id, sdp: offer });
    });
}
