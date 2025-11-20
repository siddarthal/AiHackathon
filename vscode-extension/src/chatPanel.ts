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
    private currentAbortController: AbortController | null = null;

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
                        this.sendCurrentApiMode();
                        break;
                    case "getApiMode":
                        this.sendCurrentApiMode();
                        break;
                    case "switchApiMode":
                        await this.handleSwitchApiMode(message.mode as string);
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
                    case "stopGeneration":
                        this.handleStopGeneration();
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

    private sendCurrentApiMode(): void {
        const config = vscode.workspace.getConfiguration("codellama");
        const apiMode = config.get<string>("apiMode", "local");
        void this.panel.webview.postMessage({ type: "apiMode", mode: apiMode });
    }

    private async handleSwitchApiMode(newMode: string): Promise<void> {
        const config = vscode.workspace.getConfiguration("codellama");
        await config.update("apiMode", newMode, vscode.ConfigurationTarget.Global);
        
        // Update UI
        this.sendCurrentApiMode();
        
        // Show notification
        const modeLabel = newMode === "token" ? "Cloud (Token)" : "Local (Ollama)";
        void vscode.window.showInformationMessage(`Switched to ${modeLabel} mode`);
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

        // Create new abort controller for this request
        this.currentAbortController = new AbortController();

        try {
            const payload = this.buildChatPayload(messages, filesForRequest);
            const response = await this.backend.chat(payload, { signal: this.currentAbortController.signal });

            // Check if request was aborted
            if (this.currentAbortController?.signal.aborted) {
                this.setState({ busy: false });
                return;
            }

            // Add metadata about which mode and model was used
            let contentWithMeta = response.answer.trim();
            if (response.api_mode_used && response.model_used) {
                contentWithMeta += `\n\n_[${response.api_mode_used}: ${response.model_used}]_`;
            }

            const assistantMessage: ConversationEntry = {
                role: "assistant",
                content: contentWithMeta,
                timestamp: Date.now()
            };

            this.setState({
                messages: [...messages, assistantMessage],
                busy: false
            });
        } catch (error) {
            // Ignore abort errors
            if (error instanceof Error && error.name === 'AbortError') {
                this.setState({ busy: false });
                return;
            }
            
            const friendlyMessage = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`Chat failed: ${friendlyMessage}`);
            this.setState({ busy: false, error: friendlyMessage, files: filesForRequest });
        } finally {
            this.currentAbortController = null;
        }
    }

    private handleStopGeneration(): void {
        // Abort the current request
        if (this.currentAbortController) {
            this.currentAbortController.abort();
            this.setState({ 
                busy: false
            });
            void vscode.window.showInformationMessage("Generation stopped");
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
        }
        header h1 {
            margin: 0;
            font-size: 1rem;
            font-weight: 600;
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
            padding: 12px 16px;
            border-radius: 12px;
            max-width: 100%;
            line-height: 1.6;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-editorWidget-border);
        }
        .message.user {
            background: var(--vscode-input-background);
            border-color: var(--vscode-input-border);
        }
        .message.assistant {
            background: var(--vscode-editorWidget-background);
            border-color: var(--vscode-editorWidget-border);
        }
        .message-label {
            font-size: 11px;
            font-weight: 600;
            opacity: 0.7;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
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
            display: flex;
            align-items: flex-end;
            gap: 8px;
            padding: 12px;
            background: var(--vscode-editorWidget-background);
            border-radius: 12px;
            border: 1px solid var(--vscode-editorWidget-border);
        }
        .input-area-container {
            flex: 1;
            position: relative;
        }
        textarea {
            width: 100%;
            min-height: 50px;
            max-height: 200px;
            resize: none;
            padding: 12px 12px 40px 12px;
            border-radius: 8px;
            border: none;
            background: transparent;
            color: var(--vscode-input-foreground);
            font-family: var(--vscode-font-family);
            font-size: 14px;
        }
        textarea:focus {
            outline: none;
        }
        .input-footer {
            position: absolute;
            bottom: 8px;
            left: 8px;
            right: 8px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .input-buttons {
            display: flex;
            gap: 6px;
            align-items: center;
        }
        .icon-button {
            width: 28px;
            height: 28px;
            border-radius: 6px;
            border: 1px solid var(--vscode-editorWidget-border);
            background: transparent;
            color: var(--vscode-foreground);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            opacity: 0.7;
        }
        .icon-button:hover {
            opacity: 1;
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .agent-selector {
            position: relative;
            display: inline-block;
        }
        .agent-button {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px 10px;
            border-radius: 12px;
            background: var(--vscode-button-secondaryBackground);
            font-size: 11px;
            font-weight: 500;
            cursor: pointer;
            border: 1px solid var(--vscode-button-border, transparent);
            color: var(--vscode-button-secondaryForeground);
        }
        .agent-button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .agent-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: var(--vscode-charts-green);
        }
        .agent-dot.gemini {
            background: var(--vscode-charts-purple);
        }
        .agent-dot.openai {
            background: var(--vscode-charts-blue);
        }
        .agent-dropdown {
            position: absolute;
            bottom: 100%;
            left: 0;
            margin-bottom: 4px;
            background: var(--vscode-dropdown-background);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            min-width: 140px;
            display: none;
            z-index: 1000;
        }
        .agent-dropdown.show {
            display: block;
        }
        .agent-option {
            padding: 8px 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
        }
        .agent-option:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .agent-option:first-child {
            border-radius: 8px 8px 0 0;
        }
        .agent-option:last-child {
            border-radius: 0 0 8px 8px;
        }
        .agent-option.selected {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }
        .send-button {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            border: none;
            cursor: pointer;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            flex-shrink: 0;
            transition: background 0.2s;
        }
        .send-button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .send-button.processing {
            background: var(--vscode-errorForeground);
        }
        .send-button.processing:hover {
            background: var(--vscode-errorForeground);
            opacity: 0.9;
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
        .status,
        .error {
            display: none !important;
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
            <h1>Raasi</h1>
        </header>
        <div class="messages" id="messages"></div>
        <form id="chat-form">
            <div class="attachments" id="attachments"></div>
            <div class="input-wrapper">
                <div class="input-area-container">
                    <textarea id="chat-input" placeholder="Ask anything..."></textarea>
                    <div class="input-footer">
                        <div class="input-buttons">
                            <button type="button" id="attach-file-picker" class="icon-button" title="Attach files">📎</button>
                            <button type="button" id="attach-button" class="icon-button" title="Attach active file">🗒</button>
                        </div>
                        <div class="agent-selector">
                            <div class="agent-button" id="agentButton">
                                <span class="agent-dot" id="agentDot"></span>
                                <span id="agentText">Local</span>
                                <span>▼</span>
                            </div>
                            <div class="agent-dropdown" id="agentDropdown">
                                <div class="agent-option" data-mode="local">
                                    <span class="agent-dot"></span>
                                    <span>Local</span>
                                </div>
                                <div class="agent-option" data-mode="gemini">
                                    <span class="agent-dot gemini"></span>
                                    <span>Gemini</span>
                                </div>
                                <div class="agent-option" data-mode="openai">
                                    <span class="agent-dot openai"></span>
                                    <span>OpenAI</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <button id="send-button" class="send-button" type="submit" title="Send message">↑</button>
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
        const attachBtn = document.getElementById('attach-button');
        const attachPickerBtn = document.getElementById('attach-file-picker');

        vscode.postMessage({ type: 'ready' });

        window.addEventListener('message', event => {
            const { type, payload, text, mode } = event.data;
            if (type === 'state') {
                state = payload;
                render();
            } else if (type === 'setInput') {
                inputEl.value = text || '';
                inputEl.focus();
            } else if (type === 'apiMode') {
                updateAgentUI(mode);
            }
        });
        
        function updateAgentUI(mode) {
            const agentDot = document.getElementById('agentDot');
            const agentText = document.getElementById('agentText');
            const agentDropdown = document.getElementById('agentDropdown');
            
            if (agentDot && agentText) {
                // Update button
                agentDot.className = 'agent-dot';
                if (mode === 'gemini') {
                    agentDot.classList.add('gemini');
                    agentText.textContent = 'Gemini';
                } else if (mode === 'openai') {
                    agentDot.classList.add('openai');
                    agentText.textContent = 'OpenAI';
                } else {
                    agentText.textContent = 'Local';
                }
            }
            
            // Update dropdown selected state
            if (agentDropdown) {
                const options = agentDropdown.querySelectorAll('.agent-option');
                options.forEach(option => {
                    if (option.getAttribute('data-mode') === mode) {
                        option.classList.add('selected');
                    } else {
                        option.classList.remove('selected');
                    }
                });
            }
        }

        attachBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'addActiveFile' });
        });
        attachPickerBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'addFilesFromPicker' });
        });

        // Get initial mode
        vscode.postMessage({ type: 'getApiMode' });

        // Agent selector dropdown
        const agentButton = document.getElementById('agentButton');
        const agentDropdown = document.getElementById('agentDropdown');
        
        if (agentButton && agentDropdown) {
            // Toggle dropdown
            agentButton.addEventListener('click', (e) => {
                e.stopPropagation();
                agentDropdown.classList.toggle('show');
            });
            
            // Close dropdown when clicking outside
            document.addEventListener('click', () => {
                agentDropdown.classList.remove('show');
            });
            
            // Handle option selection
            const agentOptions = agentDropdown.querySelectorAll('.agent-option');
            agentOptions.forEach(option => {
                option.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const mode = option.getAttribute('data-mode');
                    vscode.postMessage({ type: 'switchApiMode', mode: mode });
                    agentDropdown.classList.remove('show');
                });
            });
        }

        formEl.addEventListener('submit', event => {
            event.preventDefault();
            if (!state.busy) {
                vscode.postMessage({ type: 'sendMessage', text: inputEl.value });
                inputEl.value = '';
            }
        });

        // Send button click handler
        const sendBtn = document.getElementById('send-button');
        if (sendBtn) {
            sendBtn.addEventListener('click', (event) => {
                event.preventDefault();
                if (state.busy) {
                    // Stop/pause generation
                    vscode.postMessage({ type: 'stopGeneration' });
                } else {
                    // Send message
                    const text = inputEl.value.trim();
                    if (text) {
                        vscode.postMessage({ type: 'sendMessage', text });
                        inputEl.value = '';
                    }
                }
            });
        }

        function render() {
            // Update send button based on busy state
            const sendBtn = document.getElementById('send-button');
            if (sendBtn) {
                if (state.busy) {
                    sendBtn.classList.add('processing');
                    sendBtn.innerHTML = '⏸';
                    sendBtn.title = 'Stop generating';
                } else {
                    sendBtn.classList.remove('processing');
                    sendBtn.innerHTML = '↑';
                    sendBtn.title = 'Send message';
                }
            }
            
            messagesEl.innerHTML = state.messages.map((msg, index) => {
                const date = new Date(msg.timestamp).toLocaleTimeString();
                const attachmentsMarkup = renderMessageAttachments(msg.attachments);
                const roleLabel = msg.role === 'user' ? 'You' : 'Assistant';
                
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
                    <div class="message-label">\${roleLabel}</div>
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

            // Status and error are handled by VS Code notifications
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

