# Dynamic Mode Switching - Updated Architecture ✅

## 🎯 What Changed

The system has been **upgraded** to support **simultaneous dual-mode operation**!

### Before (Old Behavior):
- ❌ Backend chose ONE mode at startup (`api.mode` in app.properties)
- ❌ Had to restart backend to switch between local/cloud
- ❌ Extension setting was just informational

### After (New Behavior):
- ✅ Backend configured with BOTH local AND cloud settings
- ✅ Extension chooses mode **per request** (no restart needed!)
- ✅ Switch modes instantly from VS Code
- ✅ Each response shows which mode/model was used

---

## 🏗️ New Architecture

```
┌──────────────────────────────────────────────┐
│          VS Code Extension (User)            │
│                                              │
│  Settings: apiMode = "local" or "token"      │
│                                              │
│  User switches → Instant effect on next      │
│  request (no backend restart!)               │
└──────────────────┬───────────────────────────┘
                   │
                   │ Each request includes:
                   │ { api_mode: "local" }  OR
                   │ { api_mode: "token" }
                   │
                   ↓
┌──────────────────────────────────────────────┐
│         FastAPI Backend (Always Running)      │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  app.properties                        │ │
│  │                                        │ │
│  │  LOCAL CONFIG:                         │ │
│  │  - local.api.url=...                   │ │
│  │  - local.model.name=deepseek-coder     │ │
│  │                                        │ │
│  │  TOKEN CONFIG:                         │ │
│  │  - token.api.url=...                   │ │
│  │  - token.api.key=sk-...                │ │
│  │  - token.model.name=gpt-3.5-turbo      │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  Per-request routing:                        │
│  if (request.api_mode == "local")            │
│    → Use local config → Call Ollama          │
│  else                                        │
│    → Use token config → Call OpenAI          │
└──────────────────┬───────┬───────────────────┘
                   │       │
                   ↓       ↓
           ┌──────────┐  ┌──────────┐
           │  Ollama  │  │  OpenAI  │
           │  (local) │  │  (cloud) │
           └──────────┘  └──────────┘
```

---

## ⚙️ Setup Guide

### Step 1: Configure Backend with BOTH Modes

Edit `app.properties` and configure **BOTH** sections:

```properties
# Default mode (used if client doesn't specify)
api.mode=local

# Local configuration (for Ollama)
local.api.url=http://localhost:11434/api/generate
local.model.name=deepseek-coder:6.7b

# Cloud configuration (for OpenAI/etc)
token.api.url=https://api.openai.com/v1/chat/completions
token.api.key=sk-your-actual-key-here
token.model.name=gpt-3.5-turbo
```

**Important:** Set up BOTH, even if you only use one initially!

### Step 2: Start Backend ONCE

```bash
# Start backend - it will support BOTH modes
./start_local.sh
# OR
uvicorn main:app --reload
```

Backend logs will show:

```
Loaded configuration from app.properties
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

### Step 3: Use VS Code Extension to Switch

**Option 1: Command Palette**
```
Cmd/Ctrl + Shift + P
→ "CodeLlama: Switch API Mode"
→ Select "Local (Ollama)" or "Cloud (Token-based)"
```

**Option 2: Settings**
```
Cmd/Ctrl + ,
→ Search: "codellama.apiMode"
→ Select: "local" or "token"
```

### Step 4: Verify It's Working

```
Cmd/Ctrl + Shift + P
→ "CodeLlama: Show Configuration"
```

You'll see:
- VS Code setting: `apiMode = local` (or token)
- Backend config: Shows BOTH modes are available

---

## 🎮 Usage Examples

### Example 1: Chat with Local Model

1. Open chat: `Cmd+Shift+P` → "Open Chat"
2. Ensure mode is "local": Check status bar or settings
3. Type: "Explain this function"
4. Response will show: `[local: deepseek-coder:6.7b]`

### Example 2: Switch to Cloud and Retry

1. `Cmd+Shift+P` → "Switch API Mode"
2. Select "Cloud (Token-based)"
3. Send same question
4. Response will show: `[token: gpt-3.5-turbo]`

**No backend restart needed!**

### Example 3: Autocompletion

1. Open any code file
2. Start typing: `def hello`
3. Press `Ctrl+L` (Cmd+L on Mac)
4. Completion uses your current mode setting
5. Switch mode and try again - instant change!

---

## 🔧 API Reference

### Chat Request (New Format)

```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "api_mode": "local"
  }'
```

Response:
```json
{
  "answer": "Hello! How can I help?",
  "api_mode_used": "local",
  "model_used": "deepseek-coder:6.7b"
}
```

### Completion Request (New Format)

```bash
curl -X POST http://localhost:8000/complete \
  -H "Content-Type: application/json" \
  -d '{
    "prefix": "def hello():",
    "api_mode": "token"
  }'
```

Response:
```json
{
  "completion": "\n    return \"Hello, World!\"",
  "api_mode_used": "token",
  "model_used": "gpt-3.5-turbo"
}
```

### If `api_mode` is Not Specified

Backend uses the `api.mode` default from `app.properties`:

```bash
# No api_mode in request → uses default
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}]
  }'
# Uses api.mode from app.properties (default: "local")
```

---

## 📊 Benefits

### 1. **No Restart Needed**
- Switch between local and cloud instantly
- Test both models on same prompt
- Compare responses side-by-side

### 2. **Flexible Development**
- Use local for free testing
- Use cloud for production quality
- Switch based on task complexity

### 3. **Cost Optimization**
- Use local for simple tasks (free)
- Use cloud only when needed (paid)
- User decides per request

### 4. **Transparency**
- Every response shows which mode was used
- Know exactly what model generated response
- Easier debugging and cost tracking

---

## 🧪 Testing

### Test 1: Verify BOTH Modes Work

```bash
# Test local mode
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Say hi"}],"api_mode":"local"}'

# Test token mode
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Say hi"}],"api_mode":"token"}'
```

Both should work without restarting backend!

### Test 2: Extension Switching

1. Open chat in VS Code
2. Send message: "What is 2+2?"
3. Note the model used (bottom of response)
4. Switch mode: `Cmd+Shift+P` → "Switch API Mode"
5. Send same message again
6. Verify different model was used

### Test 3: Default Fallback

```bash
# Don't specify api_mode
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hi"}]}'
```

Should use `api.mode` from app.properties (default: local)

---

## 🐛 Troubleshooting

### Issue: "Chat failed" when switching to token mode

**Cause:** API key not configured or invalid

**Fix:**
```bash
# Edit app.properties
token.api.key=sk-your-actual-key-here

# Restart backend (only for config changes)
# No restart needed for switching modes!
```

### Issue: "Chat failed" when switching to local mode

**Cause:** Ollama not running

**Fix:**
```bash
# Start Ollama
ollama serve

# Pull model if needed
ollama pull deepseek-coder:6.7b

# Try again (no backend restart needed)
```

### Issue: Extension shows old mode

**Cause:** VS Code cache

**Fix:**
```
Cmd/Ctrl + Shift + P
→ "Developer: Reload Window"
```

### Issue: Backend always uses same mode

**Cause:** Extension not sending `api_mode`

**Fix:**
```bash
# Verify extension is compiled
cd vscode-extension
npm run compile

# Reload extension in VS Code
Press F5 (Extension Development Host)
```

---

## 🔄 Migration from Old Version

If you were using the old single-mode version:

### Old Setup:
```properties
api.mode=local
# Only one set of config
```

### New Setup:
```properties
api.mode=local  # Default

# Add BOTH configurations
local.api.url=http://localhost:11434/api/generate
local.model.name=deepseek-coder:6.7b

token.api.url=https://api.openai.com/v1/chat/completions
token.api.key=YOUR_KEY_HERE
token.model.name=gpt-3.5-turbo
```

**No code changes needed - fully backward compatible!**

---

## 📈 Performance Notes

- **Switching overhead:** ~0ms (no reconnection, just different endpoint)
- **First request:** May be slower (model loading)
- **Subsequent requests:** Fast in both modes
- **Memory:** Backend holds configs for both, minimal overhead

---

## 🎯 Summary

✅ **Configure once**: Set up both local and cloud in `app.properties`  
✅ **Start once**: Backend serves both modes simultaneously  
✅ **Switch anytime**: Use VS Code command to change mode  
✅ **No restart**: Mode switching is instant  
✅ **Transparent**: Responses show which mode was used  

**Perfect for development and flexible production use!**

