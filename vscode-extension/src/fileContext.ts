import * as vscode from "vscode";
import * as path from "path";
import { TextDecoder } from "util";

export interface AttachedFile {
    id: string;
    path: string;
    language?: string;
    content: string;
    startLine?: number;
    endLine?: number;
}

const DEFAULT_MAX_CHARS = 8000;
const textDecoder = new TextDecoder("utf-8");

function getMaxChars(): number {
    const config = vscode.workspace.getConfiguration("codellama");
    return config.get<number>("maxFileChars", DEFAULT_MAX_CHARS);
}

export async function captureActiveFile(): Promise<AttachedFile | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        void vscode.window.showWarningMessage("No active editor to attach.");
        return undefined;
    }

    const document = editor.document;
    const selection = editor.selection;
    const hasSelection = !selection.isEmpty;
    const text = hasSelection ? document.getText(selection) : document.getText();
    const maxChars = getMaxChars();
    const truncated = truncateText(text, maxChars);

    const startLine = hasSelection ? selection.start.line + 1 : 1;
    const endLine = hasSelection ? selection.end.line + 1 : document.lineCount;

    return {
        id: `${document.uri.toString()}::${Date.now()}`,
        path: vscode.workspace.asRelativePath(document.uri, false) ?? document.fileName,
        language: document.languageId,
        content: truncated,
        startLine,
        endLine
    };
}

export async function pickFilesFromWorkspace(): Promise<AttachedFile[]> {
    const uris = await vscode.window.showOpenDialog({
        canSelectMany: true,
        openLabel: "Attach",
        filters: {
            "Text / Code": ["*"]
        }
    });

    if (!uris || uris.length === 0) {
        return [];
    }

    const attachments: AttachedFile[] = [];
    for (const uri of uris) {
        const attachment = await buildAttachmentFromUri(uri);
        if (attachment) {
            attachments.push(attachment);
        }
    }
    return attachments;
}

async function buildAttachmentFromUri(uri: vscode.Uri): Promise<AttachedFile | undefined> {
    try {
        const document = await vscode.workspace.openTextDocument(uri);
        const maxChars = getMaxChars();
        const truncated = truncateText(document.getText(), maxChars);
        return {
            id: `${uri.toString()}::${Date.now()}`,
            path: vscode.workspace.asRelativePath(uri, false) ?? uri.fsPath,
            language: document.languageId,
            content: truncated,
            startLine: 1,
            endLine: document.lineCount
        };
    } catch {
        try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            const text = textDecoder.decode(bytes);
            const truncated = truncateText(text, getMaxChars());
            return {
                id: `${uri.toString()}::${Date.now()}`,
                path: vscode.workspace.asRelativePath(uri, false) ?? uri.fsPath,
                content: truncated,
                startLine: 1,
                endLine: truncated.split("\n").length
            };
        } catch (error) {
            void vscode.window.showErrorMessage(`Failed to attach ${uri.fsPath}: ${String(error)}`);
            return undefined;
        }
    }
}

export function truncateText(text: string, maxChars: number): string {
    if (text.length <= maxChars) {
        return text;
    }
    return `${text.slice(0, maxChars - 3)}...`;
}

const FILE_HANDLE_REGEX = /@([^\s]+)/g;

export async function attachFilesMentionedInPrompt(prompt: string, currentFiles: AttachedFile[]): Promise<AttachedFile[]> {
    const handles = extractFileHandles(prompt);
    if (!handles.length) {
        return [];
    }

    const existingPaths = new Set(currentFiles.map((file) => normalizePathKey(file.path)));
    const attachments: AttachedFile[] = [];

    for (const handle of handles) {
        if (existingPaths.has(normalizePathKey(handle))) {
            continue;
        }

        const attachment = await buildAttachmentFromHandle(handle);
        if (attachment) {
            existingPaths.add(normalizePathKey(attachment.path));
            attachments.push(attachment);
        }
    }

    return attachments;
}

function extractFileHandles(prompt: string): string[] {
    const handles = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = FILE_HANDLE_REGEX.exec(prompt)) !== null) {
        const raw = match[1];
        if (!raw) {
            continue;
        }
        const cleaned = raw.replace(/[.,;:!?)]*$/, "");
        if (!cleaned.includes("/") && !cleaned.includes(".")) {
            continue;
        }
        if (cleaned.startsWith("@") || cleaned.startsWith("#")) {
            continue;
        }
        handles.add(cleaned);
    }
    return Array.from(handles);
}

async function buildAttachmentFromHandle(handle: string): Promise<AttachedFile | undefined> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return undefined;
    }

    const candidates: vscode.Uri[] = [];

    if (path.isAbsolute(handle)) {
        candidates.push(vscode.Uri.file(handle));
    } else {
        for (const folder of workspaceFolders) {
            const segments = handle.split(/[\\/]/).filter(Boolean);
            const uri = vscode.Uri.joinPath(folder.uri, ...segments);
            candidates.push(uri);
        }
    }

    for (const uri of candidates) {
        const attachment = await buildAttachmentFromUri(uri);
        if (attachment) {
            return attachment;
        }
    }
    return undefined;
}

function normalizePathKey(p: string): string {
    return path.normalize(p).toLowerCase();
}

