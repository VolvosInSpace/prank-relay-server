/**
 * Prank Relay Server - Cloud relay for Remote Friend Messenger
 * Forwards messages between sender (USA) and client (Sweden)
 */

const WebSocket = require('ws');
const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store active connections by room code
const rooms = new Map();

// Secret room code hardcoded in both client and sender apps
const PRANK_ROOM_CODE = 'PRANK_ROOM_XYZ123_SECRET';

console.log('🚀 Prank Relay Server starting...');
console.log('🔐 Room Code:', PRANK_ROOM_CODE);

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Prank Relay Server Online',
    activeRooms: rooms.size,
    timestamp: new Date().toISOString()
  });
});

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  console.log('📡 New connection from:', req.socket.remoteAddress);
  
  let clientInfo = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('📨 Received message:', message.type, 'from', req.socket.remoteAddress);

      switch (message.type) {
        case 'sender_join':
          handleSenderJoin(ws, message);
          break;
        
        case 'client_join':
          handleClientJoin(ws, message);
          break;
        
        case 'prank_message':
          handlePrankMessage(ws, message);
          break;
        
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        
        default:
          console.log('❓ Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('❌ Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('📴 Connection closed from:', req.socket.remoteAddress);
    if (clientInfo) {
      handleDisconnection(clientInfo);
    }
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });

  function handleSenderJoin(ws, message) {
    const { roomCode } = message;
    
    if (roomCode !== PRANK_ROOM_CODE) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid room code' }));
      return;
    }

    if (!rooms.has(roomCode)) {
      rooms.set(roomCode, { sender: null, client: null });
    }

    const room = rooms.get(roomCode);
    room.sender = ws;
    
    clientInfo = { type: 'sender', roomCode };
    
    console.log('🎮 Sender joined room:', roomCode);
    
    // If client is already waiting, notify sender
    if (room.client) {
      ws.send(JSON.stringify({ 
        type: 'target_acquired',
        message: 'Target is online and ready for pranks! 🎯'
      }));
    } else {
      ws.send(JSON.stringify({ 
        type: 'waiting_for_target',
        message: 'Waiting for target to come online...'
      }));
    }
  }

  function handleClientJoin(ws, message) {
    const { roomCode } = message;
    
    if (roomCode !== PRANK_ROOM_CODE) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid room code' }));
      return;
    }

    if (!rooms.has(roomCode)) {
      rooms.set(roomCode, { sender: null, client: null });
    }

    const room = rooms.get(roomCode);
    room.client = ws;
    
    clientInfo = { type: 'client', roomCode };
    
    console.log('🎯 Client joined room:', roomCode);
    
    // Notify client that connection is established
    ws.send(JSON.stringify({ 
      type: 'connected',
      message: 'Connected to relay server - stealth mode active'
    }));

    // If sender is waiting, notify them that target is acquired
    if (room.sender) {
      room.sender.send(JSON.stringify({ 
        type: 'target_acquired',
        message: 'Target acquired! Ready to prank! 🎯'
      }));
    }
  }

  function handlePrankMessage(ws, message) {
    if (!clientInfo || clientInfo.type !== 'sender') {
      ws.send(JSON.stringify({ type: 'error', message: 'Only senders can send prank messages' }));
      return;
    }

    const room = rooms.get(clientInfo.roomCode);
    if (!room || !room.client) {
      ws.send(JSON.stringify({ type: 'error', message: 'No target connected' }));
      return;
    }

    // Forward the prank message to the client
    console.log('💥 Forwarding prank:', message.payload.type);
    room.client.send(JSON.stringify({
      type: 'prank_message',
      payload: message.payload
    }));

    // Confirm delivery to sender
    ws.send(JSON.stringify({ 
      type: 'prank_delivered',
      message: 'Prank delivered successfully! 💥'
    }));
  }

  function handleDisconnection(info) {
    const room = rooms.get(info.roomCode);
    if (!room) return;

    if (info.type === 'sender') {
      room.sender = null;
      console.log('🎮 Sender disconnected from room:', info.roomCode);
      
      // Notify client that sender is gone
      if (room.client) {
        room.client.send(JSON.stringify({ 
          type: 'sender_disconnected',
          message: 'Sender disconnected - entering standby mode'
        }));
      }
    } else if (info.type === 'client') {
      room.client = null;
      console.log('🎯 Client disconnected from room:', info.roomCode);
      
      // Notify sender that target is gone
      if (room.sender) {
        room.sender.send(JSON.stringify({ 
          type: 'target_lost',
          message: 'Target disconnected - waiting for reconnection...'
        }));
      }
    }

    // Clean up empty rooms
    if (!room.sender && !room.client) {
      rooms.delete(info.roomCode);
      console.log('🧹 Cleaned up empty room:', info.roomCode);
    }
  }
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🌐 Prank Relay Server running on port ${PORT}`);
  console.log(`🔗 WebSocket endpoint: ws://localhost:${PORT}`);
  console.log('💀 Ready to facilitate international pranks!');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Shutting down relay server...');
  server.close(() => {
    console.log('✅ Server shut down gracefully');
    process.exit(0);
  });
});