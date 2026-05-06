const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// State
const rooms = {};

function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      id: roomId,
      name: roomId,
      clients: new Set(),
      videoId: null,
      playing: false,
      currentTime: 0,
      lastUpdate: Date.now(),
    };
  }
  return rooms[roomId];
}

function broadcast(room, data, excludeWs = null) {
  const msg = JSON.stringify(data);
  for (const client of room.clients) {
    if (client !== excludeWs && client.readyState === 1) {
      client.send(msg);
    }
  }
}

function broadcastAll(room, data) {
  const msg = JSON.stringify(data);
  for (const client of room.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

wss.on('connection', (ws) => {
  let currentRoom = null;
  let userName = '';

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    switch (data.type) {
      case 'join': {
        const room = getOrCreateRoom(data.roomId);
        currentRoom = room;
        userName = data.userName || 'ไม่ระบุชื่อ';
        ws.userName = userName;
        room.clients.add(ws);

        // Send current state to new joiner
        ws.send(JSON.stringify({
          type: 'room_state',
          videoId: room.videoId,
          playing: room.playing,
          currentTime: room.currentTime + (room.playing ? (Date.now() - room.lastUpdate) / 1000 : 0),
          members: [...room.clients].map(c => c.userName),
        }));

        // Notify others
        broadcast(room, { type: 'system', text: `${userName} เข้าร่วมห้อง` }, ws);
        broadcastAll(room, { type: 'members', members: [...room.clients].map(c => c.userName) });
        break;
      }

      case 'play_video': {
        if (!currentRoom) return;
        currentRoom.videoId = data.videoId;
        currentRoom.playing = true;
        currentRoom.currentTime = data.currentTime || 0;
        currentRoom.lastUpdate = Date.now();
        broadcast(currentRoom, {
          type: 'play_video',
          videoId: data.videoId,
          currentTime: currentRoom.currentTime,
          by: userName,
        }, ws);
        broadcast(currentRoom, { type: 'system', text: `${userName} เปิดวิดีโอใหม่` }, ws);
        break;
      }

      case 'play': {
        if (!currentRoom) return;
        currentRoom.playing = true;
        currentRoom.currentTime = data.currentTime || 0;
        currentRoom.lastUpdate = Date.now();
        broadcast(currentRoom, { type: 'play', currentTime: currentRoom.currentTime }, ws);
        break;
      }

      case 'pause': {
        if (!currentRoom) return;
        currentRoom.playing = false;
        currentRoom.currentTime = data.currentTime || 0;
        currentRoom.lastUpdate = Date.now();
        broadcast(currentRoom, { type: 'pause', currentTime: currentRoom.currentTime }, ws);
        break;
      }

      case 'seek': {
        if (!currentRoom) return;
        currentRoom.currentTime = data.currentTime;
        currentRoom.lastUpdate = Date.now();
        broadcast(currentRoom, { type: 'seek', currentTime: data.currentTime }, ws);
        break;
      }

      case 'chat': {
        if (!currentRoom) return;
        broadcastAll(currentRoom, {
          type: 'chat',
          userName,
          text: data.text,
          time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
        });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      currentRoom.clients.delete(ws);
      broadcast(currentRoom, { type: 'system', text: `${userName} ออกจากห้อง` });
      broadcastAll(currentRoom, { type: 'members', members: [...currentRoom.clients].map(c => c.userName) });
      if (currentRoom.clients.size === 0) {
        delete rooms[currentRoom.id];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`WatchParty server running on port ${PORT}`);
});
