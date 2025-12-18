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
const roomConfigs = {
    'Genel Sohbet': { password: null },
    'Oyun Odası': { password: null },
    'Müzik Odası': { password: null },
    'AFK': { password: null }
};

const bannedUsers = new Set(); // Stores banned usernames or IPs (using usernames for simplicity as per request)
const ADMIN_KEY = "admin123";  // Simple key for initial admin claim

// Helpers
const getGlobalRoomState = () => {
    const state = {};
    for (const r in roomConfigs) {
        state[r] = [];
    }

    for (const id in users) {
        const u = users[id];
        if (u.room && state[u.room]) {
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
    // Attach "locked" property to keys for client to see? 
    // Easier: Emit room configs separately or embed it.
    // Let's emit a separate "room-config-update" to let clients know which are locked.
    socket.emit('room-list-update', publicRoomState);
    socket.emit('room-config-update', roomConfigs);


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

        // Rename logic is tricky because keys are room names. 
        // We'll assume roomId IS user-facing name for now (as per script.js).
        // If renaming, we must migrate users. This is complex.
        // User asked: "Change room names".

        const oldName = data.roomId;
        let newName = data.newName || oldName;

        // If Name Changed
        if (oldName !== newName) {
            // copy config
            roomConfigs[newName] = { password: data.password || null };
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
            // Just update password
            roomConfigs[oldName].password = data.password || null;
        }

        io.emit('room-config-update', roomConfigs);
        io.emit('room-list-update', getGlobalRoomState());
    });

    // --- BAN MANAGEMENT ---
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
