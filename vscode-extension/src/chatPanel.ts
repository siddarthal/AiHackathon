import * as vscode from "vscode";
import { BackendClient, ChatMessagePayload, ChatRequestPayload, FileReferencePayload } from "./backendClient";
import { AttachedFile, attachFilesMentionedInPrompt, captureActiveFile, pickFilesFromWorkspace } from "./fileContext";

interface ConversationEntry {
    role: "user" | "assistant";
    content: string;
    timestamp: number;
    attachments?: AttachedFile[];
}

interface PanelState {
    messages: ConversationEntry[];
    files: AttachedFile[];
    busy: boolean;
    error?: string;
    contextFile?: AttachedFile; // Track the main file being worked on
}

const INITIAL_STATE: PanelState = {
    messages: [],
    files: [],
    busy: false
};

export class ChatPanel {
    public static readonly viewType = "codellama.chat";
    public static currentPanel: ChatPanel | undefined;

    private readonly panel: vscode.WebviewPanel;
    private readonly backend: BackendClient;
    private disposables: vscode.Disposable[] = [];
    private state: PanelState = INITIAL_STATE;

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        this.panel = panel;
        this.backend = new BackendClient(context);
        this.panel.webview.html = this.getHtml();

        this.setState(INITIAL_STATE);

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.type) {
                    case "ready":
                        this.syncWebviewState();
                        break;
                    case "addActiveFile":
                        await this.handleAddActiveFile();
                        break;
                    case "addFilesFromPicker":
                        await this.handleAddFilesFromPicker();
                        break;
                    case "removeFile":
                        this.handleRemoveFile(message.id as string);
                        break;
                    case "clearContext":
                        this.handleClearContext();
                        break;
                    case "sendMessage":
                        await this.handleSendMessage(message.text as string);
                        break;
                    case "applyToFile":
                        await this.handleApplyToFile(message.messageIndex as number);
                        break;
                    default:
                        break;
                }
            },
            undefined,
            this.disposables
        );
    }

    public static createOrShow(context: vscode.ExtensionContext, initialMessage?: string, fileToAttach?: AttachedFile): void {
        const column = vscode.window.activeTextEditor?.viewColumn;

        if (ChatPanel.currentPanel) {
            ChatPanel.currentPanel.panel.reveal(column);
            if (initialMessage) {
                ChatPanel.currentPanel.setInputText(initialMessage);
            }
            if (fileToAttach) {
                ChatPanel.currentPanel.addFile(fileToAttach);
            }
            ChatPanel.currentPanel.syncWebviewState();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            ChatPanel.viewType,
            "CodeLlama Chat",
            column ?? vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        ChatPanel.currentPanel = new ChatPanel(panel, context);
        
        if (initialMessage) {
            // Wait for webview to be ready
            setTimeout(() => {
                ChatPanel.currentPanel?.setInputText(initialMessage);
            }, 300);
        }
        
        if (fileToAttach) {
            setTimeout(() => {
                ChatPanel.currentPanel?.addFile(fileToAttach);
            }, 300);
        }
    }

    public setInputText(text: string): void {
        this.panel.webview.postMessage({
            type: "setInput",
            text: text
        });
    }

    public addFile(file: AttachedFile): void {
        this.setState({
            files: [...this.state.files, file]
        });
    }

    public dispose(): void {
        ChatPanel.currentPanel = undefined;

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            disposable?.dispose();
        }

        this.panel.dispose();
    }

    private setState(partialState: Partial<PanelState>): void {
        this.state = {
            ...this.state,
            ...partialState
        };
        this.syncWebviewState();
    }

    private syncWebviewState(): void {
        this.panel.webview.postMessage({
            type: "state",
            payload: this.state
        });
    }

    public async handleAddActiveFile(): Promise<void> {
        const file = await captureActiveFile();
        if (!file) {
            return;
        }

        this.setState({
            ...this.state,
            files: [...this.state.files, file]
        });

        void vscode.window.showInformationMessage(`Attached ${file.path}`);
    }

    private async handleAddFilesFromPicker(): Promise<void> {
        const files = await pickFilesFromWorkspace();
        if (!files.length) {
            return;
        }

        this.setState({
            files: [...this.state.files, ...files]
        });

        void vscode.window.showInformationMessage(`Attached ${files.length} file(s)`);
    }

    private handleRemoveFile(id: string): void {
        this.setState({
            ...this.state,
            files: this.state.files.filter((f) => f.id !== id)
        });
    }

    private handleClearContext(): void {
        this.setState({
            messages: [],
            files: [],
            busy: false,
            error: undefined,
            contextFile: undefined
        });
        void vscode.window.showInformationMessage("Chat context cleared");
    }

    private async handleApplyToFile(messageIndex: number): Promise<void> {
        const message = this.state.messages[messageIndex];
        if (!message || message.role !== "assistant") {
            void vscode.window.showErrorMessage("Invalid message");
            return;
        }

        // Extract code blocks from the response
        const codeBlocks = this.extractCodeBlocks(message.content);
        if (codeBlocks.length === 0) {
            void vscode.window.showWarningMessage("No code blocks found in response");
            return;
        }

        // Try to find the target file:
        // 1. From the original user message attachments
        // 2. From the conversation context file (tracked across messages)
        const userMessage = this.state.messages[messageIndex - 1];
        const targetFile = userMessage?.attachments?.[0] || this.state.contextFile;
        
        if (!targetFile) {
            // No attachment - try active editor or create new file
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                void vscode.window.showWarningMessage("No file reference found. Opening code in new editor.");
                const doc = await vscode.workspace.openTextDocument({
                    content: codeBlocks[0].code,
                    language: codeBlocks[0].language || "plaintext"
                });
                await vscode.window.showTextDocument(doc);
                return;
            }
            
            // Apply to active editor (replace selection or insert at cursor)
            const codeToApply = await this.pickCodeBlock(codeBlocks);
            if (!codeToApply) {
                return;
            }

            const selection = editor.selection;
            await editor.edit(editBuilder => {
                if (!selection.isEmpty) {
                    editBuilder.replace(selection, codeToApply);
                } else {
                    editBuilder.insert(selection.active, codeToApply);
                }
            });
            
            void vscode.window.showInformationMessage("Code applied to active editor");
            return;
        }

        // Find the file in workspace
        const files = await vscode.workspace.findFiles(`**/${targetFile.path}`);
        if (files.length === 0) {
            void vscode.window.showWarningMessage(`File not found: ${targetFile.path}`);
            return;
        }

        const doc = await vscode.workspace.openTextDocument(files[0]);
        const editor = await vscode.window.showTextDocument(doc);

        // Apply the first code block (or let user choose if multiple)
        const codeToApply = await this.pickCodeBlock(codeBlocks);
        if (!codeToApply) {
            return;
        }

        // Replace the original selection range or insert at cursor
        const startLine = (targetFile.startLine || 1) - 1;
        const endLine = (targetFile.endLine || startLine + 1) - 1;
        const range = new vscode.Range(
            startLine,
            0,
            Math.min(endLine + 1, doc.lineCount),
            0
        );

        await editor.edit(editBuilder => {
            editBuilder.replace(range, codeToApply + "\n");
        });

        void vscode.window.showInformationMessage("Code applied successfully");
    }

    private async pickCodeBlock(codeBlocks: Array<{ code: string; language?: string }>): Promise<string | undefined> {
        if (codeBlocks.length === 1) {
            return codeBlocks[0].code;
        }

        const choice = await vscode.window.showQuickPick(
            codeBlocks.map((block, i) => ({
                label: `Code Block ${i + 1}`,
                description: block.language || "plaintext",
                detail: block.code.substring(0, 100) + "...",
                index: i
            })),
            { placeHolder: "Select code block to apply" }
        );

        return choice ? codeBlocks[choice.index].code : undefined;
    }

    private extractCodeBlocks(text: string): Array<{ code: string; language?: string }> {
        const blocks: Array<{ code: string; language?: string }> = [];
        const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
        let match;

        while ((match = codeBlockRegex.exec(text)) !== null) {
            blocks.push({
                language: match[1],
                code: match[2].trim()
            });
        }

        // If no code blocks, treat entire response as code
        if (blocks.length === 0 && text.trim()) {
            // Check if it looks like code (has indentation, semicolons, braces)
            if (/[{};]|^\s{2,}/m.test(text)) {
                blocks.push({ code: text.trim() });
            }
        }

        return blocks;
    }

    private async handleSendMessage(text: string): Promise<void> {
        const trimmed = text.trim();
        if (!trimmed) {
            void vscode.window.showWarningMessage("Please enter a prompt.");
            return;
        }

        const autoLinkedFiles = await attachFilesMentionedInPrompt(trimmed, this.state.files);
        let filesForRequest: AttachedFile[] = this.state.files;
        if (autoLinkedFiles.length) {
            filesForRequest = [...this.state.files, ...autoLinkedFiles];
            this.setState({
                files: filesForRequest
            });
            void vscode.window.showInformationMessage(`Auto-linked ${autoLinkedFiles.length} file(s)`);
        }

        const userMessage: ConversationEntry = {
            role: "user",
            content: trimmed,
            timestamp: Date.now(),
            attachments: filesForRequest.length ? filesForRequest : undefined
        };

        const messages = [...this.state.messages, userMessage];
        
        // Update context file if we're attaching files
        const newContextFile = filesForRequest.length > 0 ? filesForRequest[0] : this.state.contextFile;
        
        this.setState({ 
            messages, 
            busy: true, 
            error: undefined, 
            files: [],
            contextFile: newContextFile
        });

        try {
            const payload = this.buildChatPayload(messages, filesForRequest);
            const response = await this.backend.chat(payload);

            const assistantMessage: ConversationEntry = {
                role: "assistant",
                content: response.answer.trim(),
                timestamp: Date.now()
            };

            this.setState({
                messages: [...messages, assistantMessage],
                busy: false
            });
        } catch (error) {
            const friendlyMessage = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`Chat failed: ${friendlyMessage}`);
            this.setState({ busy: false, error: friendlyMessage, files: filesForRequest });
        }
    }

    private buildChatPayload(messages: ConversationEntry[], files: AttachedFile[]): ChatRequestPayload {
        const apiMessages: ChatMessagePayload[] = messages.map((msg) => ({
            role: msg.role,
            content: msg.content
        }));

        const filePayloads: FileReferencePayload[] = files.map((file) => ({
            path: file.path,
            content: file.content,
            language: file.language,
            start_line: file.startLine,
            end_line: file.endLine
        }));

        return {
            messages: apiMessages,
            files: filePayloads.length ? filePayloads : undefined
        };
    }

    private getHtml(): string {
        const nonce = getNonce();
        const csp = [
            "default-src 'none';",
            "style-src 'unsafe-inline';",
            `script-src 'nonce-${nonce}';`
        ].join(" ");

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CodeLlama Chat</title>
    <style>
        :root {
            color-scheme: light dark;
            font-size: 14px;
        }
        body {
            margin: 0;
            padding: 0;
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-foreground);
        }
        .container {
            display: flex;
            flex-direction: column;
            height: 100vh;
        }
        header {
            padding: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background: linear-gradient(
                135deg,
                var(--vscode-editorWidget-background),
                var(--vscode-sideBar-background)
            );
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        header h1 {
            margin: 0;
            font-size: 1rem;
            font-weight: 600;
        }
        .clear-button {
            padding: 4px 10px;
            border-radius: 4px;
            border: 1px solid var(--vscode-button-border, transparent);
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            cursor: pointer;
            font-size: 12px;
        }
        .clear-button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .messages {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .message {
            padding: 12px;
            border-radius: 12px;
            max-width: 80%;
            line-height: 1.4;
        }
        .message.user {
            align-self: flex-end;
            background: var(--vscode-editor-selectionBackground);
            color: var(--vscode-editor-selectionForeground, var(--vscode-foreground));
        }
        .message.assistant {
            align-self: flex-start;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-editorWidget-border);
        }
        .attachments {
            padding: 8px 0;
            display: none;
            gap: 8px;
            flex-wrap: wrap;
        }
        .attachment-pill {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 999px;
            padding: 4px 10px;
            display: flex;
            gap: 6px;
            align-items: center;
            background: var(--vscode-editorWidget-background);
        }
        .attachment-pill button {
            border: none;
            background: transparent;
            color: inherit;
            cursor: pointer;
        }
        .message-attachments {
            margin-top: 8px;
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
        }
        .message-attachment-pill {
            padding: 2px 8px;
            border-radius: 999px;
            border: 1px solid var(--vscode-panel-border);
            background: transparent;
            font-size: 0.85em;
            opacity: 0.8;
        }
        form {
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .input-wrapper {
            position: relative;
        }
        textarea {
            width: 100%;
            min-height: 90px;
            resize: vertical;
            padding: 12px 80px 12px 12px;
            border-radius: 8px;
            border: 1px solid var(--vscode-editorWidget-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
        }
        .input-buttons {
            position: absolute;
            bottom: 8px;
            right: 12px;
            display: flex;
            gap: 6px;
        }
        .icon-button {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            border: 1px solid var(--vscode-editorWidget-border);
            background: var(--vscode-editorWidget-background);
            color: var(--vscode-foreground);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
        }
        .actions button {
            border-radius: 6px;
            padding: 6px 12px;
            border: none;
            cursor: pointer;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .status {
            padding: 8px 16px;
            color: var(--vscode-descriptionForeground);
        }
        .error {
            color: var(--vscode-errorForeground);
            padding: 0 16px 12px 16px;
        }
        .apply-button {
            margin-top: 8px;
            padding: 6px 12px;
            border-radius: 6px;
            border: 1px solid var(--vscode-button-border, transparent);
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            cursor: pointer;
            font-size: 13px;
        }
        .apply-button:hover {
            background: var(--vscode-button-hoverBackground);
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>CodeLlama Copilot</h1>
            <button id="clearBtn" class="clear-button" title="Clear chat and context">🗑️ Clear</button>
        </header>
        <div class="status" id="status"></div>
        <div class="messages" id="messages"></div>
        <div class="error" id="error"></div>
        <form id="chat-form">
            <div class="attachments" id="attachments"></div>
            <div class="input-wrapper">
                <textarea id="chat-input" placeholder="Ask CodeLlama anything..."></textarea>
                <div class="input-buttons">
                    <button type="button" id="attach-file-picker" class="icon-button" title="Attach files">📎</button>
                    <button type="button" id="attach-button" class="icon-button" title="Attach active file">🗒</button>
                </div>
            </div>
            <div class="actions">
                <button id="send-button" type="submit">Send</button>
            </div>
        </form>
    </div>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let state = ${JSON.stringify(INITIAL_STATE)};

        const messagesEl = document.getElementById('messages');
        const attachmentsEl = document.getElementById('attachments');
        const formEl = document.getElementById('chat-form');
        const inputEl = document.getElementById('chat-input');
        const errorEl = document.getElementById('error');
        const statusEl = document.getElementById('status');
        const attachBtn = document.getElementById('attach-button');
        const attachPickerBtn = document.getElementById('attach-file-picker');

        vscode.postMessage({ type: 'ready' });

        window.addEventListener('message', event => {
            const { type, payload, text } = event.data;
            if (type === 'state') {
                state = payload;
                render();
            } else if (type === 'setInput') {
                inputEl.value = text || '';
                inputEl.focus();
            }
        });

        attachBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'addActiveFile' });
        });
        attachPickerBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'addFilesFromPicker' });
        });
        
        const clearBtn = document.getElementById('clearBtn');
        clearBtn.addEventListener('click', () => {
            if (confirm('Clear all messages and context?')) {
                vscode.postMessage({ type: 'clearContext' });
            }
        });

        formEl.addEventListener('submit', event => {
            event.preventDefault();
            vscode.postMessage({ type: 'sendMessage', text: inputEl.value });
            inputEl.value = '';
        });

        function render() {
            messagesEl.innerHTML = state.messages.map((msg, index) => {
                const date = new Date(msg.timestamp).toLocaleTimeString();
                const attachmentsMarkup = renderMessageAttachments(msg.attachments);
                
                // Only show "Apply to File" for assistant messages that contain code
                let applyButton = '';
                if (msg.role === 'assistant') {
                    const hasCodeBlock = /\`\`\`/.test(msg.content);
                    const looksLikeCode = /^[\\s]*(class |def |function |public |private |const |let |var |import |package )/m.test(msg.content);
                    
                    if (hasCodeBlock || looksLikeCode) {
                        applyButton = \`<button class="apply-button" data-index="\${index}">✨ Apply to File</button>\`;
                    }
                }
                
                return \`<div class="message \${msg.role}">
                    <div class="meta">\${msg.role === 'user' ? 'You' : 'CodeLlama'} · \${date}</div>
                    <div>\${escapeHtml(msg.content).replace(/\\n/g, '<br>')}</div>
                    \${attachmentsMarkup}
                    \${applyButton}
                </div>\`;
            }).join('');
            
            // Attach click handlers to apply buttons
            messagesEl.querySelectorAll('.apply-button').forEach(button => {
                button.addEventListener('click', () => {
                    const index = parseInt(button.dataset.index || '0', 10);
                    vscode.postMessage({ type: 'applyToFile', messageIndex: index });
                });
            });

            if (state.files.length) {
                attachmentsEl.style.display = 'flex';
                attachmentsEl.innerHTML = state.files.map(file => \`<div class="attachment-pill">
                        <span>\${file.path}</span>
                        <small>\${file.startLine ?? 1}-\${file.endLine ?? ''}</small>
                        <button data-id="\${file.id}" class="remove">✕</button>
                    </div>\`).join('');
                attachmentsEl.querySelectorAll('.remove').forEach(button => {
                    button.addEventListener('click', () => {
                        vscode.postMessage({ type: 'removeFile', id: button.dataset.id });
                    });
                });
            } else {
                attachmentsEl.style.display = 'none';
                attachmentsEl.innerHTML = '';
            }

            errorEl.textContent = state.error ?? '';
            statusEl.textContent = state.busy ? 'Thinking…' : '';
            inputEl.disabled = state.busy;
        }

        function renderMessageAttachments(files) {
            if (!files || !files.length) {
                return '';
            }
            const chips = files.map(file => {
                const range = file.startLine && file.endLine ? \` \${file.startLine}-\${file.endLine}\` : '';
                return \`<span class="message-attachment-pill">\${escapeHtml(file.path)}\${range}</span>\`;
            }).join('');
            return \`<div class="message-attachments">\${chips}</div>\`;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.innerText = text;
            return div.innerHTML;
        }
    </script>
</body>
</html>`;
    }
}

function getNonce(): string {
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from({ length: 32 }, () => possible.charAt(Math.floor(Math.random() * possible.length))).join("");
}

