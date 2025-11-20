#!/bin/bash
# Quick start script for cloud API mode

echo "================================================"
echo "Starting AI Code Assistant Backend (Cloud Mode)"
echo "================================================"
echo ""

# Check if app.properties exists
if [ ! -f "app.properties" ]; then
    echo "⚠️  app.properties not found!"
    echo "Creating from example..."
    cp app.properties.example app.properties
    
    # Switch to token mode
    sed -i.bak 's/^api.mode=local/api.mode=token/' app.properties
    
    echo "✅ Created app.properties in cloud mode"
    echo ""
    echo "⚠️  IMPORTANT: Edit app.properties and set your API key!"
    echo "   token.api.key=your-actual-api-key-here"
    echo ""
    read -p "Press Enter after setting your API key..."
fi

# Check if API key is set
if grep -q "token.api.key=$" app.properties || grep -q "token.api.key=YOUR_API_KEY_HERE" app.properties; then
    echo ""
    echo "❌ ERROR: API key not configured!"
    echo ""
    echo "Edit app.properties and set:"
    echo "  token.api.key=your-actual-api-key"
    echo ""
    exit 1
fi

# Display current config
echo "Current configuration (from app.properties):"
grep "^api.mode" app.properties
grep "^token.model.name" app.properties
grep "^token.api.url" app.properties
echo "  token.api.key=****** (hidden)"
echo ""

# Start the backend
echo "Starting FastAPI backend on http://localhost:8000"
echo "Press Ctrl+C to stop"
echo "================================================"
echo ""

uvicorn main:app --reload --host 0.0.0.0 --port 8000

