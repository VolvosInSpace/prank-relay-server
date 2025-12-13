# Prank Relay Server

Cloud relay server for the Remote Friend Messenger prank system.

## Deployment

### Option 1: Heroku (Free Tier)
```bash
# Install Heroku CLI
# Create new app
heroku create your-prank-relay

# Deploy
git add .
git commit -m "Deploy prank relay"
git push heroku main

# Your WebSocket URL will be:
# wss://your-prank-relay.herokuapp.com
```

### Option 2: Railway (Free Tier)
```bash
# Install Railway CLI
npm install -g @railway/cli

# Deploy
railway login
railway init
railway up

# Your WebSocket URL will be:
# wss://your-app.railway.app
```

### Option 3: Render (Free Tier)
1. Connect GitHub repo to Render
2. Create new Web Service
3. Build command: `npm install`
4. Start command: `npm start`

## Configuration

Update the WebSocket URL in both client and sender apps:
- `client/src/types.ts` - Update `RELAY_SERVER_URL`
- `sender/src/types.ts` - Update `RELAY_SERVER_URL`

## Testing

```bash
npm install
npm start
```

Server will run on `http://localhost:3000`
WebSocket endpoint: `ws://localhost:3000`