# Test Scenarios - CodeLlama VS Code Extension

## ✅ Build & Syntax Tests
- [x] Python backend syntax: **PASSED** (no syntax errors)
- [x] TypeScript compilation: **PASSED** (compiled successfully)
- [x] No linter errors: **PASSED**

## 🧪 Test Scenarios

### 1. Chat Basic Functionality
**Test:** Open chat and send a simple message
- [ ] Command: `CodeLlama: Open Chat`
- [ ] Send: "Hello, explain what you can do"
- [ ] Expected: Model responds with capabilities

### 2. File Attachment - Active File
**Test:** Attach currently open file
- [ ] Open a code file (e.g., `fibonacci.java`)
- [ ] Click paperclip icon 📎 in chat
- [ ] Send: "explain this code"
- [ ] Expected: Model explains the actual file content

### 3. File Attachment - File Picker
**Test:** Attach files via picker
- [ ] Click notepad icon 🗒️ in chat
- [ ] Select multiple files
- [ ] Send: "summarize these files"
- [ ] Expected: Files shown as chips, model summarizes

### 4. Auto-linking Files (@mention)
**Test:** Mention files in prompt
- [ ] Send: "explain @src/main.py and @README.md"
- [ ] Expected: Files auto-attached and analyzed

### 5. Right-Click - Ask CodeLlama
**Test:** Select code and ask about it
- [ ] Select code in editor
- [ ] Right-click → "Ask CodeLlama"
- [ ] Expected: Chat opens with selected code attached, pre-filled message

### 6. Right-Click - Fix in Chat
**Test:** Right-click on error to fix
- [ ] Open file with linter errors
- [ ] Right-click → "Fix in Chat"
- [ ] Expected: Chat opens with error context and file attached

### 7. Apply to File
**Test:** Apply model's code suggestions
- [ ] Attach a file with a bug
- [ ] Send: "fix the bug in line 5"
- [ ] Click "✨ Apply to File" on response
- [ ] Expected: Code applied to original file

### 8. Clear Context
**Test:** Clear chat and start fresh
- [ ] Attach file, have conversation
- [ ] Click "🗑️ Clear" button
- [ ] Send new unrelated message
- [ ] Expected: Old context cleared, fresh response

### 9. Inline Autocomplete - Manual Trigger
**Test:** Trigger completion with Cmd+L
- [ ] Open code file
- [ ] Type partial code: `public void test()`
- [ ] Press `Cmd+L` (Mac) or `Ctrl+L` (Windows/Linux)
- [ ] Expected: Ghost text suggestion appears

### 10. Inline Autocomplete - Automatic
**Test:** Automatic completion after pause
- [ ] Open code file
- [ ] Type partial code
- [ ] Wait 2 seconds without typing
- [ ] Expected: Ghost text suggestion appears

### 11. Multi-turn Conversation with Context
**Test:** Follow-up messages use context
- [ ] Attach `fibonacci.java`
- [ ] Send: "explain"
- [ ] Send: "add print statements" (no file attached)
- [ ] Expected: Model modifies original fibonacci.java

### 12. Apply to File - No Context
**Test:** Apply code when no file attached
- [ ] Send: "write a hello world function"
- [ ] Click "✨ Apply to File"
- [ ] Expected: Applies to active editor or creates new file

---

## 🔧 Backend API Tests

### Chat Endpoint
```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```
**Expected:** Returns `{"answer": "..."}`

### Completion Endpoint
```bash
curl -X POST http://localhost:8000/complete \
  -H "Content-Type: application/json" \
  -d '{
    "prefix": "def fibonacci(",
    "suffix": "",
    "language": "python",
    "max_tokens": 50
  }'
```
**Expected:** Returns `{"completion": "..."}`

### Health Check
```bash
curl http://localhost:8000/
```
**Expected:** Returns `{"title": "RAG over Local Files + Ollama", ...}`

---

## 🐛 Known Issues / Limitations

1. **CodeLlama 7B Chat Quality**
   - May hallucinate problems in code
   - May not follow complex instructions well
   - **Recommendation:** Use `mistral` or `llama2` for better chat
   - Autocomplete with DeepSeek-Coder works great ✅

2. **File Context in Multi-turn**
   - Files only sent in first message
   - Model must remember context (not always reliable)
   - **Workaround:** Use "🗑️ Clear" and re-attach for fresh context

3. **Apply to File - Line Range**
   - May not preserve exact line ranges
   - Best for full file replacements
   - **Workaround:** Review diff before applying (feature TODO)

---

## 📋 Checklist Before Demo

- [ ] Backend running: `uvicorn main:app --reload --port 8000`
- [ ] Ollama running with models:
  - [ ] `codellama:7b` (or better: `mistral`, `llama2`)
  - [ ] `deepseek-coder:6.7b`
- [ ] Extension loaded in VS Code (F5)
- [ ] Test simple chat message
- [ ] Test file attachment
- [ ] Test autocomplete (Cmd+L)
- [ ] Test "Apply to File"
- [ ] Test "Clear" button

---

## 🎯 Success Criteria

### Chat
- ✅ Opens without errors
- ✅ Sends/receives messages
- ✅ Attaches files (3 methods)
- ✅ Displays attachments as chips
- ✅ Shows "Apply to File" only for code responses
- ✅ Clears context properly

### Autocomplete
- ✅ Triggers on Cmd+L
- ✅ Auto-triggers after 2s pause
- ✅ Shows ghost text
- ✅ No duplicate code in completion
- ✅ Cancels pending requests on new keystrokes

### File Operations
- ✅ Captures active file
- ✅ Captures selection with line numbers
- ✅ Auto-links @mentions
- ✅ Applies code to correct file
- ✅ Tracks context across conversation

### UX
- ✅ Copilot-style UI
- ✅ Clear error messages
- ✅ Attachment pills
- ✅ Loading states
- ✅ Keyboard shortcuts work

