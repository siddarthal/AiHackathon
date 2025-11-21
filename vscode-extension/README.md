# Raasi AI - Your Intelligent Coding Assistant

**Raasi AI** is a powerful VS Code extension that brings AI-powered coding assistance directly into your editor with support for multiple AI models.

## ✨ Features

### 🤖 Multi-Model Support
- **Local Models**: Run models locally using Ollama (privacy-first, no API costs)
- **Google Gemini**: Fast and intelligent cloud-based assistance
- **OpenAI**: GPT-powered responses for complex tasks

### 💬 Intelligent Chat
- Interactive chat panel with context-aware conversations
- Attach files or code selections for targeted help
- Create new files directly from code snippets in responses
- Apply code changes to existing files with one click

### ⚡ Smart Autocomplete
- AI-powered code completions as you type
- Works across all supported languages
- Trigger manually with `Cmd/Ctrl + L`

### 🎯 Context Menu Integration
- Right-click to "Ask Raasi" about selected code
- Quick "Fix in Chat" option for debugging

## 🚀 Getting Started

### Prerequisites
1. **Backend**: Run the Raasi AI backend server (Python/FastAPI)
   ```bash
   cd /path/to/ai-hackathon
   python main.py
   ```

2. **Local Model (Optional)**: Install Ollama and pull a model
   ```bash
   ollama pull qwen2.5-coder
   ```

3. **Cloud APIs (Optional)**: Get API keys for Gemini or OpenAI

### Installation
1. Install the extension from `.vsix` file:
   - Open VS Code
   - Go to Extensions view (`Cmd/Ctrl + Shift + X`)
   - Click `...` menu → "Install from VSIX..."
   - Select `raasi-ai-1.0.0.vsix`

2. Configure the backend URL:
   - Open Settings (`Cmd/Ctrl + ,`)
   - Search for "Raasi"
   - Set "Backend URL" to your backend (default: `http://localhost:8000`)

### Configuration

Configure API settings in the backend's `app.properties`:

```properties
# Local Model (Ollama)
local.api.url=http://localhost:11434/api/generate
local.model.name=qwen2.5-coder:latest

# Google Gemini
gemini.api.url=https://generativelanguage.googleapis.com/v1beta/models
gemini.api.key=YOUR_GEMINI_API_KEY
gemini.model.name=gemini-1.5-flash-latest

# OpenAI
openai.api.url=https://api.openai.com/v1/chat/completions
openai.api.key=YOUR_OPENAI_API_KEY
openai.model.name=gpt-4
```

## 📖 Usage

### Open Chat Panel
- Command Palette: `Raasi: Open Chat`
- Or right-click code → "Ask Raasi"

### Switch Between Models
Click the **Agent** dropdown in the chat panel to switch between:
- 🟢 **Local** - Privacy-first, runs on your machine
- 🟣 **Gemini** - Fast Google AI
- 🔵 **OpenAI** - Powerful GPT models

*Note: Chat clears when switching models for a fresh context*

### Attach Files
- Click the 📎 button to attach files to your chat
- Right-click in editor → "Ask Raasi" auto-attaches the selection

### Create Files from Responses
- When AI generates code, click the **create** button
- Choose a filename and location
- File opens automatically in editor

### Apply Code Changes
- When you have a file attached, the **apply** button appears
- Click to apply the AI's suggested changes directly to your file

### Trigger Autocomplete
- Autocomplete works automatically as you type
- Force trigger: `Cmd/Ctrl + L`

## 🎨 Key Features

- **Smart Context Management**: Automatically manages conversation history
- **Model Switching**: Seamlessly switch between Local/Gemini/OpenAI
- **File Operations**: Create new files or apply changes to existing ones
- **Clean UI**: Minimalist design that stays out of your way
- **Code Block Handling**: Proper syntax detection and formatting

## 🛠️ Commands

| Command | Description | Keyboard Shortcut |
|---------|-------------|-------------------|
| `Raasi: Open Chat` | Open the chat panel | - |
| `Raasi: Trigger Inline Completion` | Manually trigger autocomplete | `Cmd/Ctrl + L` |
| `Ask Raasi` | Send selected code to chat | Right-click menu |
| `Fix in Chat` | Ask AI to fix issues | Right-click menu |
| `Raasi: Switch API Mode` | Change between Local/Gemini/OpenAI | - |

## ⚙️ Settings

- `raasi.backendUrl`: Backend server URL (default: `http://localhost:8000`)
- `raasi.apiMode`: Default API mode (`local`, `gemini`, or `openai`)
- `raasi.maxFileChars`: Maximum characters to attach from files (default: 8000)

## 🐛 Troubleshooting

**Chat not responding?**
- Ensure backend is running (`python main.py`)
- Check backend URL in settings
- Verify API keys in `app.properties` (for cloud modes)

**Autocomplete not working?**
- Try manual trigger: `Cmd/Ctrl + L`
- Check if the file type is supported
- Restart VS Code

**Model switching issues?**
- Chat automatically clears when switching models
- This is expected behavior for clean context

## 📝 License

This extension is built for the AI Hackathon project.

## 🤝 Contributing

Built with ❤️ for developers who want powerful AI assistance without compromising workflow.

---

**Enjoy coding with Raasi AI!** 🚀
