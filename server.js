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

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Join a specific room
    socket.on('join-room', (roomId, payload) => {
        let username = payload;
        let color = '#ffffff';

        socket.on('disconnect', () => {
            const user = users[socket.id];
            if (user) {
                console.log(`User ${user.username} disconnected`);
                socket.to(user.room).emit('user-disconnected', socket.id);

                delete users[socket.id];
                // Update list for remaining users
                io.to(user.room).emit('update-user-list', getUsersInRoom(user.room));
                io.to(user.room).emit('chat-message', {
                    username: 'Sistem',
                    text: `${user.username} ayrıldı.`,
                    type: 'system'
                });
            }
        });

        // Handle WebRTC signaling messages
        socket.on('offer', (payload) => {
            // payload: { target: targetId, caller: myId, sdp: offerSdp }
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
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Access locally: http://localhost:${PORT}`);
});
