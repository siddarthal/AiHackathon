# Raasi AI - Deployment Guide

## 📦 What You Have

Your Raasi AI extension is now fully packaged and ready to install!

**Extension File**: `vscode-extension/raasi-ai-1.0.0.vsix`

## 🚀 Installation Instructions

### Method 1: Install from VSIX (Recommended)

1. **Open VS Code**

2. **Open Extensions View**
   - Click the Extensions icon in the sidebar
   - Or press `Cmd+Shift+X` (Mac) / `Ctrl+Shift+X` (Windows/Linux)

3. **Install from VSIX**
   - Click the `...` (three dots) menu at the top of the Extensions view
   - Select "Install from VSIX..."
   - Navigate to: `/Users/siddarthalegala/Downloads/ai-hackathon/vscode-extension/raasi-ai-1.0.0.vsix`
   - Click "Install"

4. **Reload VS Code** when prompted

### Method 2: Command Line Installation

```bash
code --install-extension /Users/siddarthalegala/Downloads/ai-hackathon/vscode-extension/raasi-ai-1.0.0.vsix
```

## ⚙️ Setup After Installation

### 1. Start the Backend Server

```bash
cd /Users/siddarthalegala/Downloads/ai-hackathon
python main.py
```

The backend should start on `http://localhost:8000`

### 2. Configure API Keys (Optional)

Create or edit `app.properties` in the main directory:

```properties
# Local Model (Ollama) - No API key needed
local.api.url=http://localhost:11434/api/generate
local.model.name=qwen2.5-coder:latest

# Google Gemini (Optional)
gemini.api.url=https://generativelanguage.googleapis.com/v1beta/models
gemini.api.key=YOUR_GEMINI_API_KEY_HERE
gemini.model.name=gemini-1.5-flash-latest

# OpenAI (Optional)
openai.api.url=https://api.openai.com/v1/chat/completions
openai.api.key=YOUR_OPENAI_API_KEY_HERE
openai.model.name=gpt-4
```

### 3. Install Ollama (For Local Model)

If you want to use local models:

```bash
# Install Ollama
brew install ollama  # Mac
# Or download from https://ollama.ai

# Start Ollama service
ollama serve

# Pull your model
ollama pull qwen2.5-coder:latest
```

### 4. Verify Installation

1. Open VS Code
2. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
3. Type "Raasi: Open Chat"
4. The chat panel should open on the right
5. Try asking: "Hello, can you help me write code?"

## 🎯 Quick Start Guide

### Open Chat
- **Command Palette**: `Raasi: Open Chat`
- **Right-click** any code → "Ask Raasi"

### Switch Models
1. Click the **Agent** dropdown in chat (shows "Local" by default)
2. Select:
   - **Local** 🟢 - Uses Ollama (free, private)
   - **Gemini** 🟣 - Fast Google AI (requires API key)
   - **OpenAI** 🔵 - GPT models (requires API key)

### Use Autocomplete
- Type code naturally - suggestions appear automatically
- **Manual trigger**: Press `Cmd+L` (Mac) or `Ctrl+L` (Windows/Linux)

### Create Files from Chat
1. Ask: "Create a Java UserService class"
2. When AI responds with code, click the **create** button
3. Choose filename and location
4. File opens automatically!

### Apply Code to Existing Files
1. Open a file in VS Code
2. Attach it to chat (📎 button)
3. Ask: "Add error handling to this function"
4. Click **apply** button to update the file

## 🎨 Features Summary

| Feature | Description |
|---------|-------------|
| **Multi-Model** | Switch between Local/Gemini/OpenAI instantly |
| **Smart Chat** | Context-aware conversations with file attachments |
| **Autocomplete** | AI-powered code suggestions as you type |
| **File Operations** | Create new files or apply changes directly |
| **Context Menu** | Right-click integration for quick access |
| **Privacy First** | Use local models - no data leaves your machine |

## 🐛 Troubleshooting

### Extension Not Loading
```bash
# Check if VS Code recognizes the extension
code --list-extensions | grep raasi
```

### Backend Connection Issues
```bash
# Test backend is running
curl http://localhost:8000/health

# Should return: {"status":"healthy","model":"..."}
```

### Ollama Not Working
```bash
# Check Ollama is running
ollama list

# Restart Ollama
killall ollama
ollama serve
```

### Chat Not Responding
1. Check backend is running (`python main.py`)
2. Verify backend URL in VS Code Settings → "Raasi"
3. Check the VS Code Output panel (View → Output → select "Raasi AI")

### Model Switch Issues
- Chat automatically clears when switching models (this is intentional)
- Ensure API keys are configured in `app.properties`
- Restart backend after changing `app.properties`

## 📂 Project Structure

```
ai-hackathon/
├── main.py                          # Backend server (FastAPI)
├── app.properties                   # Configuration (API keys, models)
├── requirements.txt                 # Python dependencies
├── faiss_index/                     # Vector store for RAG
└── vscode-extension/
    ├── raasi-ai-1.0.0.vsix         # 👈 Your packaged extension
    ├── package.json                 # Extension manifest
    ├── src/                         # TypeScript source
    └── dist/                        # Compiled JavaScript
```

## 🔧 Development Mode (Optional)

If you want to modify the extension:

```bash
cd vscode-extension

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes (auto-compile)
npm run watch

# Press F5 in VS Code to launch Extension Development Host
```

## 📤 Sharing Your Extension

### Share the VSIX File
Simply share `raasi-ai-1.0.0.vsix` with others. They can install it using the same methods above.

### Publish to VS Code Marketplace (Advanced)

1. Create a publisher account at https://marketplace.visualstudio.com
2. Get a Personal Access Token from Azure DevOps
3. Publish:
   ```bash
   npx vsce publish
   ```

## 🎓 Demo Script (For Hackathon)

### 1. Installation Demo (1 min)
- Show the VSIX file
- Install in VS Code
- Show the extension appears in Extensions list

### 2. Local Model Demo (2 min)
- Open Chat Panel
- Select "Local" agent
- Ask: "Write a Python function to calculate Fibonacci"
- Show response generation
- Click "create" to make a new file

### 3. Multi-Model Demo (2 min)
- Switch to "Gemini" agent (chat clears)
- Ask: "Optimize this code for performance"
- Show faster response time
- Switch to "OpenAI" agent
- Show different response style

### 4. Autocomplete Demo (1 min)
- Open a new file
- Start typing: `def calculate_`
- Show AI completion suggestions
- Accept with Tab

### 5. File Context Demo (1 min)
- Open existing code file
- Right-click → "Ask Raasi"
- Ask: "Add error handling"
- Click "apply" to update file

### 6. Privacy Feature (30 sec)
- Highlight: "Local mode = no data leaves your machine"
- Show backend logs (no external API calls)

## ✅ Checklist for Deployment

- [x] Extension compiled and packaged
- [x] README.md with full documentation
- [x] .vscodeignore to exclude source files
- [x] Backend server working
- [x] Multi-model support (Local/Gemini/OpenAI)
- [x] Chat panel with file attachments
- [x] Code creation and application features
- [x] Autocomplete functionality
- [x] Context menu integration
- [x] Model switching with auto-clear

## 🎉 Success!

Your Raasi AI extension is production-ready!

**Extension Location**: 
```
/Users/siddarthalegala/Downloads/ai-hackathon/vscode-extension/raasi-ai-1.0.0.vsix
```

**Next Steps**:
1. Install the extension in VS Code
2. Start the backend server
3. Test all features
4. Demo at the hackathon!

---

Built with ❤️ for the AI Hackathon | Version 1.0.0

