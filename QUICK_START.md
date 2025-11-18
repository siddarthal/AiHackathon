# 🚀 Quick Start Guide - CodeLlama VS Code Extension

## 📦 What You Built

A **fully-featured VS Code extension** like GitHub Copilot, powered by local LLMs:
- 💬 **Chat with file context** (attach any files, auto-link @mentions)
- ⚡ **Inline code completion** (ghost text suggestions)
- 🔧 **Right-click commands** (Ask CodeLlama, Fix in Chat)
- ✨ **Apply to File** (insert AI-generated code directly)
- 🧹 **Context management** (clear and restart conversations)

---

## ⚡ Quick Start (5 Steps)

### 1. Start Ollama Models
```bash
# Make sure Ollama is running
ollama list

# If models not installed:
ollama pull codellama:7b
ollama pull deepseek-coder:6.7b
```

### 2. Start Backend
```bash
cd /Users/siddarthalegala/Downloads/ai-hackathon
uvicorn main:app --reload --port 8000
```

**You should see:**
```
INFO:     Uvicorn running on http://127.0.0.1:8000
```

### 3. Launch Extension
1. Open workspace in VS Code/Cursor
2. Press **F5** (or Run → Start Debugging)
3. New "Extension Development Host" window opens

### 4. Test Chat
In the new window:
1. **Cmd+Shift+P** (Mac) or **Ctrl+Shift+P** (Windows/Linux)
2. Type: `CodeLlama: Open Chat`
3. Say: "Hello, what can you do?"

### 5. Test Autocomplete
1. Open or create a `.java` or `.py` file
2. Type: `public void test()`
3. Press **Cmd+L** (Mac) or **Ctrl+L** (Windows/Linux)
4. Ghost text appears → Press **Tab** to accept

---

## 🎮 Feature Guide

### 💬 Chat Features

#### Method 1: Attach Active File
1. Open a code file
2. Open chat
3. Click **📎** (paperclip icon)
4. Ask: "explain this code"

#### Method 2: Attach Multiple Files
1. Open chat
2. Click **🗒️** (notepad icon)
3. Select multiple files
4. Ask: "summarize these"

#### Method 3: Auto-link with @
1. Open chat
2. Type: `explain @src/main.py`
3. File auto-attaches!

### 🔧 Right-Click Commands

#### Ask CodeLlama
1. Select code in editor
2. Right-click → **Ask CodeLlama**
3. Chat opens with code attached
4. Ask your question

#### Fix in Chat
1. Right-click anywhere in a file
2. Select **Fix in Chat**
3. Chat opens with errors (if any) and file attached
4. Get AI suggestions

### ✨ Apply to File

When the model responds with code:
1. Click **✨ Apply to File** button
2. Code applies to original file automatically
3. Review changes

### 🗑️ Clear Context

Click **🗑️ Clear** in chat header to:
- Clear all messages
- Reset file context
- Start fresh conversation

---

## ⌨️ Keyboard Shortcuts

| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| Trigger Autocomplete | `Cmd+L` | `Ctrl+L` |
| Accept Suggestion | `Tab` | `Tab` |
| Dismiss Suggestion | `Esc` | `Esc` |
| Open Command Palette | `Cmd+Shift+P` | `Ctrl+Shift+P` |

---

## 🔧 Configuration

### Settings (Cmd+, or Ctrl+,)

Search for "CodeLlama":

```json
{
  "codellama.backendUrl": "http://localhost:8000",
  "codellama.maxFileChars": 8000
}
```

### Switch Chat Model (Better Quality)

For better chat responses, use Mistral or Llama2:

```bash
# Download Mistral (recommended)
ollama pull mistral

# Set environment variable
export OLLAMA_MODEL=mistral

# Restart backend
uvicorn main:app --reload --port 8000
```

**Note:** DeepSeek-Coder remains for autocomplete (it's optimized for that)

---

## 🐛 Troubleshooting

### Chat not responding
- ✅ Check backend is running: `http://localhost:8000`
- ✅ Check Ollama is running: `ollama list`
- ✅ Check terminal for errors

### Autocomplete not showing
- ✅ Try manual trigger: `Cmd+L` / `Ctrl+L`
- ✅ Check file type is supported (`.java`, `.py`, `.ts`, etc.)
- ✅ Check VS Code setting: `"editor.inlineSuggest.enabled": true`
- ✅ Disable Copilot if installed (conflicts)

### Model giving wrong answers
- ✅ Click **🗑️ Clear** to reset context
- ✅ Be more explicit in prompts
- ✅ Consider switching to `mistral` or `llama2` for chat

### "Apply to File" not working
- ✅ Make sure file was attached to conversation
- ✅ Check model response contains code blocks (```language)
- ✅ Try clicking "Apply" again

---

## 📊 Performance Tips

### Autocomplete Speed
- Runs on DeepSeek-Coder (fast, optimized)
- 2-second debounce prevents too many requests
- Request cancellation on new keystrokes

### Chat Speed
- CodeLlama 7B: ~2-5 seconds
- Mistral: ~3-6 seconds
- Larger models slower but better quality

### Memory Usage
- CodeLlama 7B: ~4-6 GB
- DeepSeek-Coder 6.7B: ~4-5 GB
- Mistral 7B: ~4-6 GB
- Total: ~8-12 GB with both running

---

## 📁 Project Structure

```
ai-hackathon/
├── main.py                      # FastAPI backend
├── requirements.txt             # Python dependencies
├── test_scenarios.md            # Manual test cases
├── TEST_REPORT.md               # Automated test results
├── QUICK_START.md               # This file
├── switch_chat_model.sh         # Model switching helper
└── vscode-extension/
    ├── package.json             # Extension config
    ├── src/
    │   ├── extension.ts         # Entry point
    │   ├── chatPanel.ts         # Chat UI
    │   ├── completionProvider.ts # Autocomplete
    │   ├── backendClient.ts     # API calls
    │   └── fileContext.ts       # File handling
    └── dist/                    # Compiled output
```

---

## 🎯 Test Scenarios

See `test_scenarios.md` for comprehensive test cases covering:
- Chat basic functionality
- File attachment (3 methods)
- Right-click commands
- Apply to File
- Clear context
- Inline autocomplete
- Multi-turn conversation
- Backend API

---

## 🚀 Demo Script

1. **Show Chat**
   - Open chat
   - Attach a file
   - Ask to explain
   - Ask to modify (multi-turn)
   - Click "Apply to File"

2. **Show Autocomplete**
   - Open Java file
   - Start typing a method
   - Press Cmd+L
   - Accept with Tab

3. **Show Right-Click**
   - Select code
   - Right-click → "Ask CodeLlama"
   - Right-click → "Fix in Chat"

4. **Show Context Management**
   - Have a conversation
   - Click "Clear"
   - Start fresh topic

---

## 💡 Tips & Best Practices

### For Better Responses
- Be specific in prompts
- Attach relevant files
- Use "Apply to File" to test changes
- Clear context when switching topics

### For Faster Autocomplete
- Use Cmd+L for manual trigger
- Wait for 2s pause for auto-trigger
- Keep functions/methods reasonably sized

### For Better Code Quality
- Review AI suggestions before applying
- Test generated code
- Use as a starting point, not final solution

---

## 🎉 What's Next?

### Optional Improvements
- [ ] Switch to Mistral for better chat quality
- [ ] Add diff preview before applying code
- [ ] Add model selection dropdown in chat
- [ ] Add code snippets library
- [ ] Add conversation export
- [ ] Add telemetry/analytics

### Enjoy your local AI coding assistant! 🚀

No data leaves your machine. No API keys. Full control.

