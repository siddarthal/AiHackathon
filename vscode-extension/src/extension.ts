import * as vscode from "vscode";
import { ChatPanel } from "./chatPanel";
import { BackendClient } from "./backendClient";
import { CodeLlamaCompletionProvider, SUPPORTED_LANGUAGES } from "./completionProvider";

export function activate(context: vscode.ExtensionContext): void {
    const outputChannel = vscode.window.createOutputChannel("CodeLlama Copilot");
    context.subscriptions.push(outputChannel);

    const backend = new BackendClient(context);

    const openChatCommand = vscode.commands.registerCommand("codellama.openChat", () => {
        ChatPanel.createOrShow(context);
    });

    const inlineProvider = new CodeLlamaCompletionProvider(backend, outputChannel);
    const documentSelectors: vscode.DocumentSelector = SUPPORTED_LANGUAGES.map((lang) => ({
        scheme: "file",
        language: lang
    }));
    const inlineProviderRegistration = vscode.languages.registerInlineCompletionItemProvider(
        documentSelectors,
        inlineProvider
    );

    // Manual trigger command
    const triggerInlineCommand = vscode.commands.registerCommand("codellama.triggerInlineCompletion", async () => {
        await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
    });

    // Ask about selection - opens chat with selected code
    const askAboutSelectionCommand = vscode.commands.registerCommand("codellama.askAboutSelection", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) {
            void vscode.window.showWarningMessage("Please select code first");
            return;
        }

        const selection = editor.selection;
        const startLine = selection.start.line + 1;
        const endLine = selection.end.line + 1;
        
        // Capture file before opening chat (to preserve selection)
        const { captureActiveFile } = await import("./fileContext");
        const fileToAttach = await captureActiveFile();
        
        const initialMessage = `Explain this code (lines ${startLine}-${endLine}):`;
        
        ChatPanel.createOrShow(context, initialMessage, fileToAttach);
    });

    // Fix in chat - opens chat with error context and asks for fix
    const fixInChatCommand = vscode.commands.registerCommand("codellama.fixInChat", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            void vscode.window.showWarningMessage("No active editor");
            return;
        }

        const document = editor.document;
        const diagnostics = vscode.languages.getDiagnostics(document.uri);
        
        // Get current line or selection
        const selection = editor.selection;
        const position = selection.active;
        
        // Find errors near cursor
        const nearbyErrors = diagnostics.filter(diag => 
            diag.range.contains(position) || 
            Math.abs(diag.range.start.line - position.line) <= 5
        );

        let contextMessage = "Fix this code";
        
        if (nearbyErrors.length > 0) {
            contextMessage += ":\n\nErrors:\n";
            nearbyErrors.forEach(diag => {
                contextMessage += `- Line ${diag.range.start.line + 1}: ${diag.message}\n`;
            });
        } else {
            contextMessage = "Help me fix or improve this code";
        }

        // Capture file before opening chat
        const { captureActiveFile } = await import("./fileContext");
        const fileToAttach = await captureActiveFile();
        
        ChatPanel.createOrShow(context, contextMessage, fileToAttach);
    });

    context.subscriptions.push(
        openChatCommand, 
        inlineProviderRegistration, 
        inlineProvider, 
        triggerInlineCommand,
        askAboutSelectionCommand,
        fixInChatCommand
    );
}

export function deactivate(): void {
    // no-op
}

