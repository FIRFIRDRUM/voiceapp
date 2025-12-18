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

// State
const users = {}; // { socketId: { username, room, color, avatar } }
const rooms = ['Genel Sohbet', 'Oyun Odası', 'Müzik Odası', 'AFK']; // Predefined rooms

const getGlobalRoomState = () => {
    const state = {};
    rooms.forEach(r => state[r] = []);

    for (const id in users) {
        const u = users[id];
        if (u.room && state[u.room]) {
            state[u.room].push({
                username: u.username,
                avatar: u.avatar,
                id: id
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
                avatar: users[id].avatar
            });
        }
    }
    return usersInRoom;
};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Initial State
    socket.emit('room-list-update', getGlobalRoomState());

    // Login / Update Identity (Optional separate event, but currently handled in join)

    // Join Room Handler
    socket.on('join-room', (roomId, payload) => {
        let username = 'Misafir';
        let color = '#ffffff';
        let avatar = 'https://cdn-icons-png.flaticon.com/512/847/847969.png'; // Default

        if (typeof payload === 'object') {
            username = payload.username || username;
            color = payload.color || color;
            avatar = payload.avatar || avatar;
        }

        // Leave previous room if any
        if (users[socket.id] && users[socket.id].room) {
            const oldRoom = users[socket.id].room;
            socket.leave(oldRoom);
            socket.to(oldRoom).emit('user-disconnected', socket.id);
            io.to(oldRoom).emit('update-user-list', getUsersInRoom(oldRoom));
        }

        // Update User Data
        users[socket.id] = { username, room: roomId, color, avatar };
        socket.join(roomId);

        console.log(`${username} joined ${roomId}`);

        // 1. Notify Room
        socket.to(roomId).emit('user-connected', socket.id);
        io.to(roomId).emit('update-user-list', getUsersInRoom(roomId));
        io.to(roomId).emit('chat-message', {
            username: 'Sistem',
            text: `${username} katıldı.`,
            type: 'system'
        });

        // 2. Broadcast Global State (For Room Previews)
        io.emit('room-list-update', getGlobalRoomState());
    });

    // Disconnect Handler
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

            // Broadcast Global State
            io.emit('room-list-update', getGlobalRoomState());
        }
    });

    // WebRTC Signaling
    socket.on('offer', (payload) => {
        io.to(payload.target).emit('offer', payload);
    });

    socket.on('answer', (payload) => {
        io.to(payload.target).emit('answer', payload);
    });

    socket.on('ice-candidate', (payload) => {
        io.to(payload.target).emit('ice-candidate', payload);
    });

    // Chat Message
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

    socket.on('stop-screen-share', () => {
        const user = users[socket.id];
        if (user && user.room) {
            socket.to(user.room).emit('user-stopped-screen-share', socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
