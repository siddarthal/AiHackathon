# Quick Reference Guide

## Quick Start

### 1. Backend Setup (5 minutes)

```bash
# Copy configuration template
cp app.properties.example app.properties

# Edit app.properties - choose your mode
nano app.properties  # or use any editor

# Start backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 2. Extension Setup (3 minutes)

```bash
cd vscode-extension
npm install
npm run compile
# Press F5 in VS Code to test
```

## Configuration Quick Reference

### app.properties - Local Mode
```properties
api.mode=local
local.api.url=http://localhost:11434/api/generate
local.model.name=deepseek-coder:6.7b
```

### app.properties - Cloud Mode (OpenAI)
```properties
api.mode=token
token.api.url=https://api.openai.com/v1/chat/completions
token.api.key=sk-your-key-here
token.model.name=gpt-3.5-turbo
```

## Common Commands

### Backend
```bash
# Start server
uvicorn main:app --reload

# Test health
curl http://localhost:8000/health

# View config
curl http://localhost:8000/config

# Run tests
python test_backend.py
```

### VS Code Extension

**Command Palette (Cmd/Ctrl + Shift + P):**
- `CodeLlama: Switch API Mode` - Switch between local/cloud
- `CodeLlama: Show Configuration` - View current settings
- `CodeLlama: Open Chat` - Open chat panel
- `CodeLlama: Trigger Inline Completion` - Manual completion (Ctrl+L)

**Right-click Context Menu:**
- `Ask CodeLlama` - Ask about selected code
- `Fix in Chat` - Get help fixing code

## Switching Between Modes

### Method 1: Extension (Recommended)
1. Open Command Palette
2. Type "Switch API Mode"
3. Select Local or Cloud
4. Done! (Extension handles the rest)

### Method 2: Backend Configuration
1. Edit `app.properties`
2. Change `api.mode=local` or `api.mode=token`
3. Restart backend
4. Test with: `curl http://localhost:8000/config`

## Testing Checklist

- [ ] Backend starts without errors
- [ ] `/health` endpoint returns status
- [ ] `/config` endpoint shows correct mode
- [ ] Extension loads in VS Code
- [ ] Chat panel opens and responds
- [ ] Autocompletion works (Ctrl+L)
- [ ] Can switch between modes
- [ ] Show configuration displays correctly

## Troubleshooting

### Backend won't start
- Check `app.properties` syntax
- Verify port 8000 is free: `lsof -i :8000`
- Check Python dependencies: `pip install -r requirements.txt`

### Local mode fails
- Ensure Ollama is running: `ollama serve`
- Test Ollama directly: `curl http://localhost:11434/api/generate`
- Check model is downloaded: `ollama list`

### Cloud mode fails
- Verify API key is correct
- Check API URL format
- Test with curl:
```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-3.5-turbo","messages":[{"role":"user","content":"test"}]}'
```

### Extension issues
- Reload VS Code window (Cmd/Ctrl + R)
- Check Output channel: "CodeLlama Copilot"
- Verify backend URL in settings
- Recompile extension: `npm run compile`

## File Locations

```
ai-hackathon/
├── main.py                    # Backend server
├── app.properties             # Your config (create from .example)
├── app.properties.example     # Config template
├── test_backend.py           # Test script
├── SETUP_GUIDE.md            # Full documentation
├── QUICK_REFERENCE.md        # This file
└── vscode-extension/
    ├── src/                   # TypeScript source
    ├── dist/                  # Compiled JavaScript
    └── package.json           # Extension manifest
```

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | API info |
| `/health` | GET | Health check + config |
| `/config` | GET | Current configuration |
| `/chat` | POST | Chat with context |
| `/complete` | POST | Code completion |
| `/ask` | POST | RAG query |
| `/reindex` | POST | Rebuild index |

## Default Models

- **Local**: `deepseek-coder:6.7b` (good for code)
- **Cloud**: `gpt-3.5-turbo` (fast, cheap)

**Alternative models:**
- Local: `codellama:13b`, `mistral`, `llama2`
- Cloud: `gpt-4`, `gpt-4-turbo`, `claude-3-sonnet`

## Support

Issues? Check:
1. `SETUP_GUIDE.md` - Detailed setup instructions
2. `CHANGES_SUMMARY.md` - What changed and why
3. Backend logs - `uvicorn` output
4. Extension logs - VS Code Output panel

---

**Remember:** After changing `app.properties`, restart the backend!

