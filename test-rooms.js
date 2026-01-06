const io = require('socket.io-client');

const socket1 = io('http://localhost:3000');
const socket2 = io('http://localhost:3000');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
    // Client 1 login
    socket1.emit('login', { username: 'User1', avatar: '', adminKey: '' });

    // Client 2 login
    socket2.emit('login', { username: 'User2', avatar: '', adminKey: '' });

    await sleep(1000);

    // Join Rooms
    console.log("Joing Rooms...");
    socket1.emit('join-room', 'Genel Sohbet'); // Top Room
    socket2.emit('join-room', 'Oyun Odası');   // Second Room

    socket1.on('room-list-update', (state) => {
        console.log("\n--- UPDATE ---");
        for (const [room, users] of Object.entries(state)) {
            console.log(`Room: "${room}" users: ${users.map(u => u.username).join(', ')}`);
        }
    });

    // Keep alive
    setTimeout(() => {
        console.log("Done.");
        // socket1.disconnect(); socket2.disconnect();
    }, 5000);
})();
