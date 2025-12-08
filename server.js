const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

const users = {}; // { socketId: { username, room, color } }

const getUsersInRoom = (roomId) => {
    const usersInRoom = [];
    for (const id in users) {
        if (users[id].room === roomId) {
            usersInRoom.push({
                id,
                username: users[id].username,
                color: users[id].color
            });
        }
    }
    return usersInRoom;
};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Join Room Handler
    socket.on('join-room', (roomId, payload) => {
        let username = payload;
        let color = '#ffffff';

        // Compatibility for object payload
        if (typeof payload === 'object') {
            username = payload.username || 'Misafir';
            // If color is an object (nested color property), handle it, otherwise use string
            if (payload.color && typeof payload.color === 'object') {
                color = payload.color.color || '#ffffff';
            } else {
                color = payload.color || '#ffffff';
            }
        }

        console.log(`User ${username} (${socket.id}) joined room ${roomId}`);

        // Store user info
        users[socket.id] = { username, room: roomId, color };

        socket.join(roomId);

        // Notify others in room
        socket.to(roomId).emit('user-connected', socket.id);

        // Broadcast updated user list
        io.to(roomId).emit('update-user-list', getUsersInRoom(roomId));

        // System message
        io.to(roomId).emit('chat-message', {
            username: 'Sistem',
            text: `${username} odaya katıldı.`,
            type: 'system'
        });
    });

    // Disconnect Handler
    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user) {
            console.log(`User ${user.username} disconnected`);
            socket.to(user.room).emit('user-disconnected', socket.id);

            delete users[socket.id];

            // Update list for remaining users
            if (user.room) {
                io.to(user.room).emit('update-user-list', getUsersInRoom(user.room));
                io.to(user.room).emit('chat-message', {
                    username: 'Sistem',
                    text: `${user.username} ayrıldı.`,
                    type: 'system'
                });
            }
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
                color: user.color
            });
        }
    });

    // Screen Share Stop Signal
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
    console.log(`Access locally: http://localhost:${PORT}`);
});
