# CodeLlama Copilot VS Code Extension

This extension lets VS Code talk to the local FastAPI backend that fronts CodeLlama. It ships with:

- **Chat panel:** multi-turn chat that can attach active-file snippets or any files from disk before sending them to `/chat`.
- **Inline autocomplete:** VS Code inline completions powered by the backend’s `/complete` endpoint (supports JS/TS, Python, Go, Rust, Java, C#, C/C++, PHP, Ruby).

## Local development

```bash
cd /Users/siddarthalegala/Downloads/ai-hackathon/vscode-extension
npm install
npm run watch
```

Press `F5` in VS Code to launch the extension development host.

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `codellama.backendUrl` | `http://localhost:8000` | FastAPI gateway for chat/completion calls. |
| `codellama.maxFileChars` | `8000` | Max characters to capture from a file when attaching to chat. |

## Testing the chat panel

1. Run the FastAPI backend (see workspace root `README`).
2. In VS Code, run the extension and execute **CodeLlama: Open Chat**.
3. Use **Attach Active File** or **Attach Files…** to include context, or just mention files inline (e.g. `Explain @src/server/routes.py`).
4. Send prompts—responses should come from the local CodeLlama model through `/chat`.

## Autocomplete

**Fresh, simplified inline completion:**

1. Make sure inline suggestions are enabled: Settings → `Editor › Inline Suggest: Enabled`
2. In a supported language file (JS/TS/Python/Java/Go/Rust/C/C++), press **Cmd+L** (Mac) or **Ctrl+L** (Windows/Linux) to manually trigger a completion
3. Ghost text will appear at your cursor; press `Tab` to accept, `Esc` to dismiss
4. Check logs in **View → Output → CodeLlama Copilot** if suggestions don't appear

