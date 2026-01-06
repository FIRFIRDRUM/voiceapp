
const DEFAULT_ROOMS = ['Genel Sohbet', 'Oyun Odası'];
const roomConfigs = {};
DEFAULT_ROOMS.forEach(r => roomConfigs[r] = { password: null, isHidden: false });

const users = {
    'socket1': { username: 'User1', room: 'Genel Sohbet', role: 'user' },
    'socket2': { username: 'User2', room: 'Oyun Odası', role: 'user' },
    'socket3': { username: 'Admin', room: 'Oyun Odası', role: 'admin' }
};

// Toggle Hidden for 'Oyun Odası'
roomConfigs['Oyun Odası'].isHidden = true;

const getGlobalRoomState = () => {
    const state = {};
    const sortedKeys = Object.keys(roomConfigs).sort();

    for (const r of sortedKeys) {
        state[r] = [];
    }

    for (const id in users) {
        const u = users[id];
        if (u.room && state[u.room]) {
            // LOGIC BEING TESTED
            if (roomConfigs[u.room] && roomConfigs[u.room].isHidden) {
                continue;
            }

            state[u.room].push({
                username: u.username,
                id: id
            });
        }
    }
    return state;
};

const result = getGlobalRoomState();
console.log("Global State:", JSON.stringify(result, null, 2));

if (result['Genel Sohbet'].length === 1 && result['Oyun Odası'].length === 0) {
    console.log("PASS: Users hidden in hidden room.");
} else {
    console.log("FAIL: Logic incorrect.");
}
