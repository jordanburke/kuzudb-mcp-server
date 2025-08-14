#!/bin/bash

# Test OAuth setup for Claude.ai integration

echo "🚀 Starting OAuth-enabled KuzuDB MCP Server for Claude.ai testing"
echo ""

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo "❌ ngrok is not installed. Please install it first:"
    echo "   brew install ngrok  (macOS)"
    echo "   snap install ngrok   (Linux)"
    echo "   Or download from: https://ngrok.com/download"
    exit 1
fi

# Build the project
echo "📦 Building project..."
pnpm build

# Initialize database if needed
if [ ! -d "test/test-db" ]; then
    echo "🗄️ Initializing test database..."
    pnpm db:init:movies
fi

# Kill any existing servers
echo "🔄 Cleaning up existing servers..."
pnpm kill

# Start the OAuth-enabled server
echo "🚀 Starting OAuth-enabled MCP server on port 3000..."
node dist/index.js test/test-db \
    --transport http \
    --oauth-config test/oauth-config.json \
    --port 3000 &

SERVER_PID=$!
echo "Server PID: $SERVER_PID"

# Wait for server to start
echo "⏳ Waiting for server to start..."
sleep 3

# Check if server is running
if ! curl -s http://localhost:3000/health > /dev/null; then
    echo "❌ Server failed to start"
    kill $SERVER_PID 2>/dev/null
    exit 1
fi

echo "✅ Server is running!"
echo ""

# Start ngrok
echo "🌐 Starting ngrok tunnel..."
ngrok http 3000 &
NGROK_PID=$!

echo ""
echo "========================================="
echo "📋 INSTRUCTIONS FOR CLAUDE.AI INTEGRATION"
echo "========================================="
echo ""
echo "1. Look for the ngrok URL in the terminal above (https://xxxxx.ngrok.io)"
echo ""
echo "2. Go to Claude.ai settings: https://claude.ai/settings/tools"
echo ""
echo "3. Add a new MCP connection with:"
echo "   - Endpoint: https://YOUR-NGROK-URL.ngrok.io/mcp"
echo "   - OAuth Authorization: https://YOUR-NGROK-URL.ngrok.io/oauth/authorize"
echo "   - OAuth Token: https://YOUR-NGROK-URL.ngrok.io/oauth/token"
echo "   - Client ID: claude-client (or anything)"
echo "   - Client Secret: (leave empty)"
echo ""
echo "4. Click Connect/Authorize"
echo ""
echo "5. Test with: 'Check the KuzuDB schema' or 'List all tables'"
echo ""
echo "Press Ctrl+C to stop both servers"
echo ""

# Wait for Ctrl+C
trap "echo '🛑 Stopping servers...'; kill $SERVER_PID $NGROK_PID 2>/dev/null; exit" INT
wait