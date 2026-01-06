const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const path = require('path');

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// --- STATE ---
const users = {}; // { socketId: { username, room, color, avatar, role: 'user'|'admin' } }
// Default Rooms with Config
const DEFAULT_ROOMS = ['Genel Sohbet', 'Oyun Odası', 'Müzik Odası', 'AFK'];
const roomConfigs = {};
DEFAULT_ROOMS.forEach(r => roomConfigs[r] = { password: null, isHidden: false });

const bannedUsers = new Set(); // Stores banned usernames or IPs (using usernames for simplicity as per request)
const ADMIN_KEY = "admin123";  // Simple key for initial admin claim

// Helpers
const getGlobalRoomState = () => {
    const state = {};
    // Sort keys: Default rooms first in order, then others alpha-sorted
    const sortedKeys = Object.keys(roomConfigs).sort((a, b) => {
        const idxA = DEFAULT_ROOMS.indexOf(a);
        const idxB = DEFAULT_ROOMS.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
    });

    for (const r of sortedKeys) {
        state[r] = [];
    }

    for (const id in users) {
        const u = users[id];
        if (u.room && state[u.room]) {
            // IF ROOM IS HIDDEN, DO NOT PUSH USER TO PUBLIC STATE
            if (roomConfigs[u.room] && roomConfigs[u.room].isHidden) {
                continue;
            }

            state[u.room].push({
                username: u.username,
                avatar: u.avatar,
                id: id,
                role: u.role
            });
        }
    }
    return state;
};

const getUsersInRoom = (roomId) => {
    const usersInRoom = [];
    for (const id in users) {
        if (users[id].room === roomId) {
            usersInRoom.push({
                id,
                username: users[id].username,
                color: users[id].color,
                avatar: users[id].avatar,
                role: users[id].role
            });
        }
    }
    return usersInRoom;
};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Initial State
    // Send room list WITH lock status
    const publicRoomState = getGlobalRoomState();
    socket.emit('room-list-update', publicRoomState);
    socket.emit('room-config-update', roomConfigs);

    // --- REMOTE CONTROL ID ---
    // Wait for client to claim ID or generate new one
    socket.on('register-remote-id', (claimedId) => {
        let finalId = claimedId;
        // Simple validation: must be 8 digits. Check collision?
        // Ideally we track all active IDs.
        const isTaken = Array.from(io.sockets.sockets.values()).some(s => s.data.remoteId === finalId && s.id !== socket.id);

        if (!finalId || finalId.length !== 8 || isTaken) {
            finalId = Math.floor(10000000 + Math.random() * 90000000).toString();
        }

        socket.data.remoteId = finalId;
        if (users[socket.id]) users[socket.id].remoteId = finalId; // Sync if user obj exists

        console.log(`Registered Remote ID ${finalId} for ${socket.id}`);
        socket.emit('your-remote-id', finalId);
    });


    // --- SIGNALING FOR REMOTE CONTROL ---

    // 1. Request Connection
    socket.on('request-remote-control', (targetRemoteId) => {
        // Find socket with this remoteId
        const targetSocket = Array.from(io.sockets.sockets.values()).find(s => s.data.remoteId === targetRemoteId);

        if (targetSocket) {
            if (targetSocket.id === socket.id) {
                socket.emit('remote-control-error', "Kendinize bağlanamazsınız.");
                return;
            }
            console.log(`Remote request from ${socket.id} (${remoteId}) to ${targetSocket.id} (${targetRemoteId})`);

            // Forward request to target
            targetSocket.emit('remote-control-request', {
                requesterId: socket.id,
                requesterRemoteId: remoteId,
                requesterUsername: users[socket.id]?.username || "Anonim"
            });
        } else {
            socket.emit('remote-control-error', "Kullanıcı bulunamadı veya ID hatalı.");
        }
    });

    // 2. Accept/Reject
    socket.on('remote-control-response', (data) => {
        // data: { requesterId, accepted: boolean }
        const requesterSocket = io.sockets.sockets.get(data.requesterId);

        if (requesterSocket) {
            if (data.accepted) {
                // Notify requester: "Start sending inputs"
                requesterSocket.emit('remote-control-accepted', {
                    targetId: socket.id,
                    targetRemoteId: remoteId
                });

                // Notify target (self): "You are being controlled"
                socket.emit('remote-self-controlled', {
                    controllerId: data.requesterId
                });

                console.log(`Connection established: ${data.requesterId} -> ${socket.id}`);
            } else {
                requesterSocket.emit('remote-control-rejected', {
                    targetRemoteId: remoteId
                });
            }
        }
    });

    // 3. Input Data Forwarding
    socket.on('remote-input-event', (data) => {
        // data: { targetId, event: { type: 'mousemove'|'click'|'keydown', x, y, key... } }
        const targetSocket = io.sockets.sockets.get(data.targetId);
        if (targetSocket) {
            // Validation? Maybe check if they actually accepted? 
            // For now trusting the client logic for simplicity, but in prod we should store "active sessions".

            targetSocket.emit('perform-input-action', data.event);
        }
    });


    // --- LOGIN ---
    socket.on('login', (payload) => {
        let { username, avatar, adminKey } = payload;

        if (bannedUsers.has(username)) {
            socket.emit('banned', { reason: 'Sunucudan yasaklandınız.' });
            return;
        }

        let role = 'user';
        if (adminKey === ADMIN_KEY) {
            role = 'admin';
        }

        // Store prompt user data (initially no room)
        users[socket.id] = { username, avatar, role, room: null, color: '#fff' };

        // Confirm
        socket.emit('login-success', { role, username });

        // Refresh Lists so Admin UI updates immediately
        socket.emit('room-list-update', getGlobalRoomState());
        socket.emit('room-config-update', roomConfigs);
    });

    // --- JOIN ROOM ---
    socket.on('join-room', (roomId, payload) => {
        // payload: { username, avatar, color, adminKey? , password? }
        let { username, avatar, color, adminKey, password } = payload || {};

        username = username || 'Misafir';
        color = color || '#ffffff';
        avatar = avatar || 'https://cdn-icons-png.flaticon.com/512/847/847969.png';

        // 1. BAN CHECK
        if (bannedUsers.has(username)) {
            socket.emit('banned', { reason: 'Sunucudan yasaklandınız.' });
            socket.disconnect();
            return;
        }

        // 2. ROOM PASSWORD CHECK
        // If room needs password and provided password is wrong/empty
        if (roomConfigs[roomId] && roomConfigs[roomId].password) {
            if (password !== roomConfigs[roomId].password) {
                socket.emit('password-required', { roomId });
                return;
            }
        }

        // 3. ADMIN CLAIM
        let role = 'user';
        if (adminKey === ADMIN_KEY) {
            role = 'admin';
        }

        // Leave previous
        if (users[socket.id] && users[socket.id].room) {
            const oldRoom = users[socket.id].room;
            socket.leave(oldRoom);
            socket.to(oldRoom).emit('user-disconnected', socket.id);
            io.to(oldRoom).emit('update-user-list', getUsersInRoom(oldRoom));
        }

        // Update User Data
        users[socket.id] = { username, room: roomId, color, avatar, role };
        socket.join(roomId);

        // Notify
        socket.to(roomId).emit('user-connected', socket.id);
        io.to(roomId).emit('update-user-list', getUsersInRoom(roomId));
        io.to(roomId).emit('chat-message', {
            username: 'Sistem',
            text: `${username} katıldı.`,
            type: 'system'
        });

        io.emit('room-list-update', getGlobalRoomState());

        // Confirm Join & Role to Client
        socket.emit('joined-success', { role, roomId });
    });


    // --- ADMIN ACTIONS ---
    socket.on('admin-action', (data) => {
        // data: { action: 'kick'|'ban'|'mute'|'promote'|'unmute', targetId }
        const executor = users[socket.id];
        const target = users[data.targetId];

        if (!executor || executor.role !== 'admin') return;
        if (!target) return;

        switch (data.action) {
            case 'kick':
                io.to(data.targetId).emit('kicked', { reason: 'Admin tarafından atıldınız.' });
                // Socket cleanup happens on disconnect usually, but we can force disconnect
                // Ideally client handles the 'kicked' event by reloading/redirecting.
                // We'll also remove them from state here just in case? 
                // Let's rely on client disconnecting or force it:
                io.sockets.sockets.get(data.targetId)?.disconnect();
                break;

            case 'ban':
                bannedUsers.add(target.username);
                io.to(data.targetId).emit('banned', { reason: 'Admin tarafından yasaklandınız.' });
                io.sockets.sockets.get(data.targetId)?.disconnect();
                break;

            case 'mute':
                io.to(data.targetId).emit('force-mute', { value: true });
                io.to(executor.room).emit('chat-message', {
                    username: 'Sistem',
                    text: `${target.username} susturuldu.`,
                    type: 'system'
                });
                break;

            case 'unmute':
                io.to(data.targetId).emit('force-mute', { value: false });
                break;

            case 'promote':
                target.role = 'admin';
                io.to(executor.room).emit('update-user-list', getUsersInRoom(executor.room));
                io.to(data.targetId).emit('role-update', { role: 'admin' });
                io.to(executor.room).emit('chat-message', {
                    username: 'Sistem',
                    text: `${target.username} artık yönetici.`,
                    type: 'system'
                });
                break;
        }
    });

    // --- ROOM MANAGEMENT ---
    socket.on('update-room-config', (data) => {
        // { roomId, newName, password }
        const executor = users[socket.id];
        if (!executor || executor.role !== 'admin') return;

        const oldName = data.roomId;
        let newName = data.newName || oldName;

        // PREVENT RENAMING DEFAULT ROOMS
        if (DEFAULT_ROOMS.includes(oldName) && oldName !== newName) {
            socket.emit('admin-error', "Varsayılan odaların adı değiştirilemez.");
            return;
        }

        // If Name Changed
        if (oldName !== newName) {
            // copy config
            roomConfigs[newName] = {
                password: data.password || null,
                isHidden: !!data.isHidden
            };
            delete roomConfigs[oldName];

            // Move users? OR just let them stay in "phantom" room until they move?
            // Correct way: Update all users in that room
            for (const id in users) {
                if (users[id].room === oldName) {
                    users[id].room = newName;
                    // socket rooms join/leave
                    const s = io.sockets.sockets.get(id);
                    if (s) {
                        s.leave(oldName);
                        s.join(newName);
                    }
                }
            }
        } else {
            // Just update password & hidden status
            roomConfigs[oldName].password = data.password || null;
            if (data.isHidden !== undefined) roomConfigs[oldName].isHidden = !!data.isHidden;
        }

        io.emit('room-config-update', roomConfigs);
        io.emit('room-list-update', getGlobalRoomState());
    });

    // --- BAN MANAGEMENT ---
    socket.on('get-rooms', () => {
        socket.emit('room-list-update', getGlobalRoomState());
        socket.emit('room-config-update', roomConfigs);
    });

    socket.on('get-ban-list', () => {
        const executor = users[socket.id];
        if (executor && executor.role === 'admin') {
            socket.emit('ban-list', Array.from(bannedUsers));
        }
    });

    socket.on('unban-user', (username) => {
        const executor = users[socket.id];
        if (executor && executor.role === 'admin') {
            bannedUsers.delete(username);
            socket.emit('ban-list', Array.from(bannedUsers)); // Update list
        }
    });


    // --- STANDARD EVENTS ---
    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user) {
            console.log(`User ${user.username} disconnected`);
            socket.to(user.room).emit('user-disconnected', socket.id);

            delete users[socket.id];

            if (user.room) {
                io.to(user.room).emit('update-user-list', getUsersInRoom(user.room));
                io.to(user.room).emit('chat-message', {
                    username: 'Sistem',
                    text: `${user.username} ayrıldı.`,
                    type: 'system'
                });
            }

            io.emit('room-list-update', getGlobalRoomState());
        }
    });

    socket.on('send-chat-message', (text) => {
        const user = users[socket.id];
        if (user && user.room) {
            io.to(user.room).emit('chat-message', {
                username: user.username,
                text: text,
                type: 'user',
                color: user.color,
                avatar: user.avatar
            });
        }
    });

    // WebRTC & Others
    socket.on('offer', p => io.to(p.target).emit('offer', p));
    socket.on('answer', p => io.to(p.target).emit('answer', p));
    socket.on('ice-candidate', p => io.to(p.target).emit('ice-candidate', p));
    socket.on('stop-screen-share', () => {
        const user = users[socket.id];
        if (user && user.room) socket.to(user.room).emit('user-stopped-screen-share', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
