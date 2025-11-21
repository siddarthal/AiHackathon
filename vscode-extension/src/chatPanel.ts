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
    messages: [
        {
            role: "assistant",
            content: "👋 Welcome to **Raasi**\n\nI'm your AI coding assistant. I can help you:\n• Write and explain code\n• Fix bugs and optimize\n• Create new files from code snippets\n• Answer technical questions\n\nJust ask me anything!",
            timestamp: Date.now()
        }
    ],
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
                    case "createFile":
                        await this.handleCreateFile(message.messageIndex as number, message.codeIndex as number);
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
            "Raasi",
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
        
        // Clear conversation context when switching models to prevent confusion
        this.setState({
            messages: [],
            files: [],
            busy: false,
            error: undefined,
            contextFile: undefined
        });
        
        // Update UI
        this.sendCurrentApiMode();
        
        // Show notification
        let modeLabel = "Local";
        if (newMode === "gemini") {
            modeLabel = "Gemini";
        } else if (newMode === "openai") {
            modeLabel = "OpenAI";
        }
        void vscode.window.showInformationMessage(`Switched to ${modeLabel} - Chat cleared for fresh start`);
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

    private async handleCreateFile(messageIndex: number, codeIndex: number): Promise<void> {
        const message = this.state.messages[messageIndex];
        if (!message || message.role !== "assistant") {
            void vscode.window.showErrorMessage("Invalid message");
            return;
        }

        const codeBlocks = this.extractCodeBlocks(message.content);
        if (codeIndex >= codeBlocks.length) {
            void vscode.window.showErrorMessage("Code block not found");
            return;
        }

        const codeBlock = codeBlocks[codeIndex];
        
        // Determine file extension from language
        const extMap: { [key: string]: string } = {
            'java': 'java',
            'python': 'py',
            'javascript': 'js',
            'typescript': 'ts',
            'cpp': 'cpp',
            'c': 'c',
            'csharp': 'cs',
            'go': 'go',
            'rust': 'rs',
            'php': 'php',
            'ruby': 'rb',
            'swift': 'swift',
            'kotlin': 'kt'
        };
        
        const ext = codeBlock.language ? (extMap[codeBlock.language.toLowerCase()] || 'txt') : 'txt';
        
        // Try to extract class/function name from code
        let suggestedName = `NewFile.${ext}`;
        
        if (codeBlock.language === 'java') {
            const classMatch = codeBlock.code.match(/(?:public\s+)?class\s+(\w+)/);
            if (classMatch) {
                suggestedName = `${classMatch[1]}.java`;
            }
        } else if (codeBlock.language === 'python') {
            const classMatch = codeBlock.code.match(/class\s+(\w+)/);
            if (classMatch) {
                suggestedName = `${classMatch[1]}.py`;
            }
        }
        
        // Ask user for filename
        const filename = await vscode.window.showInputBox({
            prompt: "Enter filename",
            value: suggestedName,
            placeHolder: `example.${ext}`
        });
        
        if (!filename) {
            return;
        }
        
        // Get workspace folder
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showErrorMessage("No workspace folder open");
            return;
        }
        
        // Create file
        const filePath = vscode.Uri.joinPath(workspaceFolder.uri, filename);
        
        try {
            // Check if file exists
            try {
                await vscode.workspace.fs.stat(filePath);
                const overwrite = await vscode.window.showWarningMessage(
                    `File ${filename} already exists. Overwrite?`,
                    "Yes", "No"
                );
                if (overwrite !== "Yes") {
                    return;
                }
            } catch {
                // File doesn't exist, continue
            }
            
            // Write file
            const content = new TextEncoder().encode(codeBlock.code);
            await vscode.workspace.fs.writeFile(filePath, content);
            
            // Open the file
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc);
            
            void vscode.window.showInformationMessage(`Created ${filename}`);
        } catch (error) {
            void vscode.window.showErrorMessage(`Failed to create file: ${error}`);
        }
    }

    private async handleSendMessage(text: string): Promise<void> {
        const trimmed = text.trim();
        if (!trimmed) {
            void vscode.window.showWarningMessage("Please enter a prompt.");
            return;
        }

        console.log(`[ChatPanel] handleSendMessage called with: "${trimmed}"`);
        console.log(`[ChatPanel] Current messages count: ${this.state.messages.length}`);

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
        console.log(`[ChatPanel] New messages array length: ${messages.length}`);
        
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
    <title>Raasi</title>
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
            display: none;
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
            color: #ffffff;
        }
        .message.user {
            background: var(--vscode-editorWidget-background);
            border-color: var(--vscode-editorWidget-border);
        }
        .message.assistant {
            background: var(--vscode-editorWidget-background);
            border-color: var(--vscode-editorWidget-border);
        }
        .message-label {
            font-size: 11px;
            font-weight: 600;
            color: #ffffff;
            opacity: 0.8;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .pinned-message {
            position: sticky;
            top: 0;
            z-index: 10;
            background: var(--vscode-editor-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            margin: -16px -16px 16px -16px;
            padding: 12px 16px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        .pinned-message .message-label {
            color: #4CAF50;
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
        .message pre {
            margin: 0;
            padding: 0;
            background: transparent;
            overflow: hidden;
        }
        .message code {
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
        }
        .message pre code {
            display: block;
            padding: 16px;
            background: var(--vscode-editor-background);
            overflow-x: auto;
            line-height: 1.6;
            border-radius: 4px;
            color: #ffffff;
        }
        .message :not(pre) > code {
            padding: 2px 6px;
            background: var(--vscode-textCodeBlock-background);
            border-radius: 3px;
            font-size: 0.9em;
        }
        .code-block-wrapper {
            margin: 12px 0;
            border-radius: 4px;
            overflow: hidden;
            background: var(--vscode-editor-background);
        }
        .code-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 6px 12px;
            background: #1e1e1e;
            color: #ffffff;
            font-size: 11px;
            font-family: var(--vscode-editor-font-family);
            border-bottom: 1px solid #3e3e3e;
        }
        .code-actions {
            display: flex;
            gap: 4px;
            align-items: center;
        }
        .create-file-button,
        .apply-button {
            padding: 3px 10px;
            border: none;
            border-radius: 3px;
            background: transparent;
            color: #ffffff;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            opacity: 0.8;
            transition: all 0.2s;
            letter-spacing: 0.3px;
        }
        .create-file-button:hover,
        .apply-button:hover {
            opacity: 1;
            background: rgba(255, 255, 255, 0.2);
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

        // Handle Enter key for submission (Shift+Enter for new line)
        inputEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (!state.busy && inputEl.value.trim()) {
                    vscode.postMessage({ type: 'sendMessage', text: inputEl.value });
                    inputEl.value = '';
                }
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
            
            // Find the last user message if busy
            let lastUserMessageIndex = -1;
            if (state.busy) {
                for (let i = state.messages.length - 1; i >= 0; i--) {
                    if (state.messages[i].role === 'user') {
                        lastUserMessageIndex = i;
                        break;
                    }
                }
            }
            
            messagesEl.innerHTML = state.messages.map((msg, index) => {
                const date = new Date(msg.timestamp).toLocaleTimeString();
                const attachmentsMarkup = renderMessageAttachments(msg.attachments);
                const roleLabel = msg.role === 'user' ? 'You' : 'Assistant';
                
                // Check if previous user message has attachments (for assistant messages)
                let hasFileContext = false;
                if (msg.role === 'assistant' && index > 0) {
                    for (let i = index - 1; i >= 0; i--) {
                        if (state.messages[i].role === 'user') {
                            hasFileContext = !!(state.messages[i].attachments && state.messages[i].attachments.length > 0);
                            break;
                        }
                    }
                }
                
                // Format content with code blocks and action buttons
                const formattedContent = formatMessageWithCodeActions(msg.content, index, msg.role, hasFileContext);
                
                // Pin the last user message while processing
                const isPinned = state.busy && index === lastUserMessageIndex;
                const pinnedClass = isPinned ? 'pinned-message' : '';
                
                return \`<div class="message \${msg.role} \${pinnedClass}">
                    <div class="message-label">\${roleLabel}</div>
                    <div>\${formattedContent}</div>
                    \${attachmentsMarkup}
                </div>\`;
            }).join('');
            
            // Attach click handlers to apply buttons
            messagesEl.querySelectorAll('.apply-button').forEach(button => {
                button.addEventListener('click', () => {
                    const index = parseInt(button.dataset.index || '0', 10);
                    vscode.postMessage({ type: 'applyToFile', messageIndex: index });
                });
            });
            
            // Attach click handlers to create file buttons
            messagesEl.querySelectorAll('.create-file-button').forEach(button => {
                button.addEventListener('click', () => {
                    const msgIndex = parseInt(button.dataset.msgIndex || '0', 10);
                    const codeIndex = parseInt(button.dataset.codeIndex || '0', 10);
                    vscode.postMessage({ type: 'createFile', messageIndex: msgIndex, codeIndex: codeIndex });
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
            
            // Auto-scroll to bottom to show latest message
            if (messagesEl) {
                messagesEl.scrollTop = messagesEl.scrollHeight;
            }
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
        
        function formatMessageContent(text) {
            return escapeHtml(text).replace(/\\n/g, '<br>');
        }
        
        function formatMessageWithCodeActions(text, msgIndex, role, hasFileContext) {
            const fence = String.fromCharCode(96, 96, 96);
            const newline = String.fromCharCode(10);
            const parts = [];
            let currentIndex = 0;
            let codeBlockIndex = 0;
            
            while (true) {
                const startIdx = text.indexOf(fence, currentIndex);
                if (startIdx === -1) {
                    if (currentIndex < text.length) {
                        parts.push({ type: 'text', content: text.substring(currentIndex) });
                    }
                    break;
                }
                
                if (startIdx > currentIndex) {
                    parts.push({ type: 'text', content: text.substring(currentIndex, startIdx) });
                }
                
                const endIdx = text.indexOf(fence, startIdx + 3);
                if (endIdx === -1) {
                    parts.push({ type: 'text', content: text.substring(startIdx) });
                    break;
                }
                
                const codeContent = text.substring(startIdx + 3, endIdx);
                const firstNewline = codeContent.indexOf(newline);
                let language = '';
                let code = codeContent;
                
                if (firstNewline > 0 && firstNewline < 20) {
                    const firstLine = codeContent.substring(0, firstNewline).trim();
                    if (firstLine && firstLine.length < 20) {
                        language = firstLine;
                        code = codeContent.substring(firstNewline + 1);
                    }
                }
                
                parts.push({ type: 'code', language: language, content: code, index: codeBlockIndex });
                codeBlockIndex++;
                currentIndex = endIdx + 3;
            }
            
            let html = '';
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (part.type === 'text') {
                    const escaped = escapeHtml(part.content);
                    html += escaped.split(newline).join('<br>');
                } else {
                    const langLabel = part.language ? escapeHtml(part.language) : 'shell';
                    html += '<div class="code-block-wrapper">';
                    html += '<div class="code-header">';
                    html += '<span>$ ' + langLabel + '</span>';
                    if (role === 'assistant') {
                        html += '<div class="code-actions">';
                        // Show "create" only when no file is attached, "apply" only when file is attached
                        if (!hasFileContext) {
                            html += '<button class="create-file-button" data-msg-index="' + msgIndex + '" data-code-index="' + part.index + '" title="Create new file">create</button>';
                        } else {
                            html += '<button class="apply-button" data-index="' + msgIndex + '" title="Apply to existing file">apply</button>';
                        }
                        html += '</div>';
                    }
                    html += '</div>';
                    html += '<pre><code>' + escapeHtml(part.content) + '</code></pre>';
                    html += '</div>';
                }
            }
            
            return html;
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

