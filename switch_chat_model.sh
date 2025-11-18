#!/bin/bash

# Helper script to switch chat models
# Usage: ./switch_chat_model.sh [model_name]

MODEL=${1:-mistral}

echo "🔄 Switching chat model to: $MODEL"
echo ""
echo "Available models:"
ollama list

echo ""
echo "Checking if $MODEL is available..."
if ollama list | grep -q "$MODEL"; then
    echo "✅ $MODEL is already downloaded"
else
    echo "📥 Downloading $MODEL..."
    ollama pull "$MODEL"
fi

echo ""
echo "✅ Done! Set this environment variable before starting the backend:"
echo ""
echo "export OLLAMA_MODEL=$MODEL"
echo ""
echo "Then restart:"
echo "uvicorn main:app --reload --port 8000"
echo ""
echo "Recommended models for chat:"
echo "  - mistral (best for instructions, 7B)"
echo "  - llama2 (great at chat, 7B)"
echo "  - codellama:13b (larger CodeLlama, better at chat)"
echo ""
echo "Current setup:"
echo "  Chat: $MODEL"
echo "  Autocomplete: deepseek-coder:6.7b (optimized for completion)"

