import * as vscode from "vscode";
import { BackendClient, CompletionRequestPayload } from "./backendClient";

export const SUPPORTED_LANGUAGES = [
    "javascript",
    "typescript",
    "typescriptreact",
    "javascriptreact",
    "python",
    "java",
    "go",
    "rust",
    "cpp",
    "c"
];

export class CodeLlamaCompletionProvider implements vscode.InlineCompletionItemProvider {
    private debounceTimer: NodeJS.Timeout | undefined;
    private abortController: AbortController | undefined;

    constructor(
        private readonly backend: BackendClient,
        private readonly outputChannel: vscode.OutputChannel
    ) {}

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | undefined> {
        // Abort any pending request
        this.abortController?.abort();
        this.abortController = new AbortController();

        // Clear debounce timer
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        const line = document.lineAt(position.line);
        const textBeforeCursor = line.text.substring(0, position.character).trim();
        
        // Skip empty lines or just whitespace
        if (!textBeforeCursor) {
            return undefined;
        }

        // Only trigger after typing stops (debounce automatic triggers)
        if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
            return new Promise((resolve) => {
                if (this.debounceTimer) {
                    clearTimeout(this.debounceTimer);
                }
                this.debounceTimer = setTimeout(async () => {
                    const result = await this.fetchCompletion(document, position, token);
                    resolve(result);
                }, 2000); // Wait 2 seconds after typing stops
            });
        }

        // Manual trigger (Cmd+L) - immediate
        return this.fetchCompletion(document, position, token);
    }

    private async fetchCompletion(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | undefined> {
        try {
            // Get context: up to 2000 chars before cursor, 500 after
            const startPos = new vscode.Position(Math.max(0, position.line - 50), 0);
            const endPos = new vscode.Position(Math.min(document.lineCount - 1, position.line + 10), 0);
            
            const prefix = document.getText(new vscode.Range(startPos, position));
            const suffix = document.getText(new vscode.Range(position, endPos));

            const payload: CompletionRequestPayload = {
                prefix: this.truncate(prefix, 2000),
                suffix: this.truncate(suffix, 500),
                language: document.languageId,
                file_path: document.fileName,
                max_tokens: 50,
                temperature: 0.1
            };

            this.outputChannel.appendLine(`[${new Date().toISOString()}] Requesting completion...`);

            const response = await this.backend.complete(payload, {
                signal: this.abortController?.signal
            });

            if (!response.completion || !response.completion.trim()) {
                this.outputChannel.appendLine("Empty completion received");
                return undefined;
            }

            let completion = response.completion.trim();
            
            // Clean up markdown code fences and backticks
            completion = this.cleanMarkdown(completion);

            if (!completion) {
                return undefined;
            }

            this.outputChannel.appendLine(`Raw completion: ${completion.substring(0, 200)}...`);

            // Strip Part A if model repeated it
            const currentLine = document.lineAt(position.line);
            const linePrefix = currentLine.text.substring(0, position.character);
            
            let finalCompletion = completion;
            
            // Try to detect and remove duplicate prefix (Part A)
            // Check if completion starts with the current line content
            const trimmedPrefix = linePrefix.trim();
            const trimmedCompletion = completion.trim();
            
            if (trimmedPrefix && trimmedCompletion.startsWith(trimmedPrefix)) {
                // Strip the duplicate part
                finalCompletion = trimmedCompletion.substring(trimmedPrefix.length).trim();
                this.outputChannel.appendLine(`Stripped duplicate prefix: "${trimmedPrefix}"`);
            }
            
            // Also check if it starts with just the non-whitespace part of what we typed
            const tokensInPrefix = trimmedPrefix.split(/\s+/);
            if (tokensInPrefix.length > 0) {
                const lastFewTokens = tokensInPrefix.slice(-3).join(' ');
                if (lastFewTokens && finalCompletion.trim().startsWith(lastFewTokens)) {
                    finalCompletion = finalCompletion.trim().substring(lastFewTokens.length).trim();
                    this.outputChannel.appendLine(`Stripped last tokens: "${lastFewTokens}"`);
                }
            }

            if (!finalCompletion) {
                this.outputChannel.appendLine(`Empty after stripping duplicates`);
                return undefined;
            }

            const item = new vscode.InlineCompletionItem(finalCompletion);
            item.range = new vscode.Range(position, position);
            
            return [item];
        } catch (error: any) {
            if (error.name === "AbortError" || error.name === "CanceledError") {
                this.outputChannel.appendLine("Request cancelled");
                return undefined;
            }
            
            this.outputChannel.appendLine(`Error: ${error.message || String(error)}`);
            if (error.response) {
                this.outputChannel.appendLine(`Response: ${JSON.stringify(error.response.data)}`);
            }
            
            return undefined;
        }
    }

    private truncate(text: string, maxLength: number): string {
        if (text.length <= maxLength) {
            return text;
        }
        return text.substring(text.length - maxLength);
    }

    private cleanMarkdown(text: string): string {
        // Remove markdown code fences (triple backticks)
        text = text.replace(/^```[\w]*\n?/gm, "");
        text = text.replace(/\n?```$/gm, "");
        
        // Remove inline backticks (single backticks)
        text = text.replace(/`/g, "");
        
        // Remove leading/trailing whitespace
        return text.trim();
    }

    dispose(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.abortController?.abort();
    }
}

