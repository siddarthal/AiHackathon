#!/bin/bash
# Quick start script for local development

echo "================================================"
echo "Starting AI Code Assistant Backend (Local Mode)"
echo "================================================"
echo ""

# Check if app.properties exists
if [ ! -f "app.properties" ]; then
    echo "⚠️  app.properties not found!"
    echo "Creating from example..."
    cp app.properties.example app.properties
    echo "✅ Created app.properties"
    echo ""
    echo "Default configuration:"
    echo "  - API Mode: local"
    echo "  - Model: deepseek-coder:6.7b"
    echo ""
    echo "Edit app.properties to customize settings"
    echo ""
fi

# Check if Ollama is running (for local mode)
if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "✅ Ollama is running"
else
    echo "⚠️  Ollama doesn't appear to be running"
    echo "For local mode, start Ollama first:"
    echo "  ollama serve"
    echo ""
fi

# Display current config
echo "Current configuration (from app.properties):"
grep "^api.mode" app.properties 2>/dev/null || echo "  api.mode=local (default)"
grep "^local.model.name" app.properties 2>/dev/null || echo "  local.model.name=deepseek-coder:6.7b (default)"
echo ""

# Start the backend
echo "Starting FastAPI backend on http://localhost:8000"
echo "Press Ctrl+C to stop"
echo "================================================"
echo ""

uvicorn main:app --reload --host 0.0.0.0 --port 8000

