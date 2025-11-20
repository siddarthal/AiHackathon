# Setup Guide - Unified AI Code Assistant

This guide covers the setup for the updated system that supports both local (Ollama) and cloud-based (token) API modes.

## Overview

The system now supports:
1. ✅ Single unified model for both chat and autocompletion
2. ✅ Configuration via `app.properties` file
3. ✅ Two API modes: Local (Ollama) and Cloud (Token-based)
4. ✅ VS Code extension UI to switch between modes

## Backend Setup

### 1. Install Dependencies

```bash
cd /Users/siddarthalegala/Downloads/ai-hackathon
pip install -r requirements.txt
```

### 2. Configure app.properties

Copy the example file and edit it:

```bash
cp app.properties.example app.properties
```

Edit `app.properties`:

**For Local Mode (Ollama):**
```properties
api.mode=local
local.api.url=http://localhost:11434/api/generate
local.model.name=deepseek-coder:6.7b
```

**For Cloud Mode (OpenAI or compatible):**
```properties
api.mode=token
token.api.url=https://api.openai.com/v1/chat/completions
token.api.key=YOUR_API_KEY_HERE
token.model.name=gpt-3.5-turbo
```

### 3. Start the Backend

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 4. Test the Backend

Open http://localhost:8000 in your browser to see the API documentation.

Test endpoints:
```bash
# Check health
curl http://localhost:8000/health

# Check config
curl http://localhost:8000/config
```

## VS Code Extension Setup

### 1. Install Extension Dependencies

```bash
cd vscode-extension
npm install
```

### 2. Compile Extension

```bash
npm run compile
```

### 3. Configure Extension

Open VS Code settings (Cmd/Ctrl + ,) and search for "CodeLlama":

- **Backend URL**: `http://localhost:8000`
- **API Mode**: Choose `local` or `token`
- **Local API URL**: `http://localhost:11434/api/generate`
- **Local Model Name**: `deepseek-coder:6.7b`
- **Token API URL**: `https://api.openai.com/v1/chat/completions`
- **Token API Key**: Your API key
- **Token Model Name**: `gpt-3.5-turbo`

### 4. Install Extension

In VS Code:
1. Press F5 to open a new Extension Development Host window
2. Or package the extension: `vsce package` (requires vsce: `npm install -g @vscode/vsce`)

## Usage

### Switching API Modes

#### Option 1: Command Palette
1. Open Command Palette (Cmd/Ctrl + Shift + P)
2. Type "CodeLlama: Switch API Mode"
3. Select Local or Cloud mode

#### Option 2: VS Code Settings
1. Open Settings (Cmd/Ctrl + ,)
2. Search for "codellama.apiMode"
3. Change to "local" or "token"

### View Configuration

1. Open Command Palette
2. Type "CodeLlama: Show Configuration"
3. See both VS Code and backend configurations

### Chat Features

- **Open Chat**: Cmd/Ctrl + Shift + P → "CodeLlama: Open Chat"
- **Ask About Selection**: Right-click on selected code → "Ask CodeLlama"
- **Fix in Chat**: Right-click → "Fix in Chat"

### Autocompletion

- **Manual Trigger**: Ctrl+L (Cmd+L on Mac)
- **Automatic**: Type code and wait for suggestions

## Configuration Reference

### app.properties Options

| Key | Description | Default |
|-----|-------------|---------|
| `api.mode` | API mode: "local" or "token" | `local` |
| `local.api.url` | Local Ollama API URL | `http://localhost:11434/api/generate` |
| `local.model.name` | Local model name | `deepseek-coder:6.7b` |
| `token.api.url` | Cloud API URL | `https://api.openai.com/v1/chat/completions` |
| `token.api.key` | API key for cloud service | (empty) |
| `token.model.name` | Cloud model name | `gpt-3.5-turbo` |
| `index.path` | FAISS index storage path | `faiss_index` |
| `embedding.model` | Embedding model name | `sentence-transformers/all-MiniLM-L6-v2` |
| `retrieval.k` | Number of documents to retrieve | `5` |
| `chat.max.tokens` | Max tokens for chat | `512` |
| `chat.temperature` | Chat temperature | `0.3` |
| `completion.max.tokens` | Max tokens for completion | `128` |
| `completion.temperature` | Completion temperature | `0.0` |
| `file.context.max.chars` | Max chars in file context | `4000` |

### VS Code Extension Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `codellama.backendUrl` | FastAPI backend URL | `http://localhost:8000` |
| `codellama.apiMode` | API mode | `local` |
| `codellama.localApiUrl` | Local API URL | `http://localhost:11434/api/generate` |
| `codellama.localModelName` | Local model name | `deepseek-coder:6.7b` |
| `codellama.tokenApiUrl` | Cloud API URL | `https://api.openai.com/v1/chat/completions` |
| `codellama.tokenApiKey` | Cloud API key | (empty) |
| `codellama.tokenModelName` | Cloud model name | `gpt-3.5-turbo` |

## Testing

### Manual Testing Checklist

#### Task 1: Single Model ✅
- [ ] Start backend in local mode
- [ ] Test chat endpoint
- [ ] Test completion endpoint
- [ ] Verify both use same model

#### Task 2: app.properties Configuration ✅
- [ ] Create `app.properties` file
- [ ] Set local mode configuration
- [ ] Start backend and verify config at `/config`
- [ ] Change to token mode
- [ ] Restart backend and verify changes

#### Task 3: Token-based API Support ✅
- [ ] Configure token mode in `app.properties`
- [ ] Add valid API key
- [ ] Test chat with cloud API
- [ ] Test completion with cloud API

#### Task 4: Extension UI Toggle ✅
- [ ] Open VS Code with extension
- [ ] Use "Switch API Mode" command
- [ ] Verify mode changes in settings
- [ ] Use "Show Configuration" to verify
- [ ] Test chat in both modes
- [ ] Test autocompletion in both modes

## Troubleshooting

### Backend Issues

**Problem**: Backend fails to start
- Check `app.properties` syntax
- Verify Python dependencies installed
- Check if port 8000 is available

**Problem**: API requests fail
- For local mode: Ensure Ollama is running
- For token mode: Verify API key is correct
- Check network connectivity

### Extension Issues

**Problem**: Extension commands not appearing
- Reload VS Code window
- Check extension is activated
- Verify extension compiled successfully

**Problem**: Completions not working
- Check backend is running at configured URL
- Verify API mode matches backend configuration
- Check output channel for errors

## Architecture Changes

### Backend (main.py)
- Added `load_properties()` function to read `app.properties`
- Added `get_config()` helper for configuration precedence
- Renamed `OllamaLangChain` → `UnifiedLLM` (supports both modes)
- Added mode-specific logic in `/chat` and `/complete` endpoints
- Added `/config` endpoint to query current configuration

### Extension (vscode-extension)
- Added new configuration settings for API mode
- Added `switchApiMode` command
- Added `showConfig` command
- Updated `BackendClient` with `getConfig()` and `getHealth()` methods
- Updated `package.json` with new commands and settings

## Next Steps

1. Test the system manually following the checklist above
2. Monitor logs for any errors
3. Adjust model parameters in `app.properties` as needed
4. Consider adding more cloud API providers (Anthropic, etc.)
5. Add settings UI panel in extension for easier configuration

