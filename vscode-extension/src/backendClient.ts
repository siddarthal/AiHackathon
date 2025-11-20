import axios, { AxiosInstance } from "axios";
import * as vscode from "vscode";

export interface FileReferencePayload {
    path: string;
    content?: string;
    language?: string;
    start_line?: number;
    end_line?: number;
}

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessagePayload {
    role: ChatRole;
    content: string;
}

export interface ChatRequestPayload {
    messages: ChatMessagePayload[];
    files?: FileReferencePayload[];
    max_tokens?: number;
    temperature?: number;
    api_mode?: string;  // "local" or "token"
}

export interface ChatResponse {
    answer: string;
    api_mode_used?: string;
    model_used?: string;
}

export interface CompletionRequestPayload {
    prefix: string;
    suffix?: string;
    language?: string;
    file_path?: string;
    max_tokens?: number;
    temperature?: number;
    related_files?: FileReferencePayload[];
    api_mode?: string;  // "local" or "token"
}

export interface CompletionResponse {
    completion: string;
    api_mode_used?: string;
    model_used?: string;
}

export interface ConfigResponse {
    api_mode: string;
    model: string;
    api_url: string;
    max_tokens: number;
    temperature: number;
    completion_temperature: number;
}

export class BackendClient {
    private readonly axiosInstance: AxiosInstance;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.axiosInstance = axios.create({
            timeout: 120000
        });
    }

    private get baseUrl(): string {
        const config = vscode.workspace.getConfiguration("codellama");
        return config.get<string>("backendUrl", "http://localhost:8000");
    }

    public updateConfig(): void {
        // This can be used to notify backend of config changes
        // For now, it's just a placeholder for future functionality
        console.log("Config updated in BackendClient");
    }

    async chat(payload: ChatRequestPayload, options?: { signal?: AbortSignal }): Promise<ChatResponse> {
        const config = vscode.workspace.getConfiguration("codellama");
        const apiMode = config.get<string>("apiMode", "local");
        
        // Add api_mode to payload if not already set
        const requestPayload = {
            ...payload,
            api_mode: payload.api_mode || apiMode
        };
        
        const url = `${this.baseUrl}/chat`;
        const response = await this.axiosInstance.post<ChatResponse>(url, requestPayload, {
            headers: { "Content-Type": "application/json" },
            signal: options?.signal
        });
        return response.data;
    }

    async complete(payload: CompletionRequestPayload, options?: { signal?: AbortSignal }): Promise<CompletionResponse> {
        const config = vscode.workspace.getConfiguration("codellama");
        const apiMode = config.get<string>("apiMode", "local");
        
        // Add api_mode to payload if not already set
        const requestPayload = {
            ...payload,
            api_mode: payload.api_mode || apiMode
        };
        
        const url = `${this.baseUrl}/complete`;
        const response = await this.axiosInstance.post<CompletionResponse>(
            url,
            requestPayload,
            {
                headers: { "Content-Type": "application/json" },
                timeout: 8000,
                signal: options?.signal
            }
        );
        return response.data;
    }

    async getConfig(): Promise<ConfigResponse> {
        const url = `${this.baseUrl}/config`;
        const response = await this.axiosInstance.get<ConfigResponse>(url);
        return response.data;
    }

    async getHealth(): Promise<any> {
        const url = `${this.baseUrl}/health`;
        const response = await this.axiosInstance.get(url);
        return response.data;
    }
}

