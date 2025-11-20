import os
import json
import traceback
from pathlib import Path
from typing import List, Optional, Dict, Any, Literal

from fastapi import FastAPI
from pydantic import BaseModel
import requests
from dotenv import load_dotenv

# LangChain imports
from langchain.schema import Document
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.vectorstores import FAISS
from langchain.embeddings import HuggingFaceEmbeddings, OpenAIEmbeddings
from langchain.chains import RetrievalQA
from langchain.llms.base import LLM

load_dotenv()


# ------------------ Configuration Loading ------------------
def load_properties(filepath: str = "app.properties") -> Dict[str, str]:
    """Load configuration from Java-style properties file."""
    props = {}
    if not os.path.exists(filepath):
        print(f"Warning: {filepath} not found, using defaults")
        return props
    
    try:
        with open(filepath, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    if '=' in line:
                        key, value = line.split('=', 1)
                        props[key.strip()] = value.strip()
        print(f"Loaded configuration from {filepath}")
    except Exception as e:
        print(f"Error loading {filepath}: {e}")
    
    return props


def get_config(key: str, default: str = "", props: Optional[Dict[str, str]] = None) -> str:
    """Get config value from properties file, then env vars, then default."""
    if props and key in props:
        return props[key]
    return os.getenv(key.replace('.', '_').upper(), default)


# Load properties file
_app_properties = load_properties("app.properties")

app = FastAPI(title="RAG over Local Files + Ollama (LangChain)")

# ------------------ CONFIG ------------------
DOCUMENTS_PATH = "/Users/siddarthalegala/Documents/Hackathon/fastapi/fastapi/"

# API Mode Configuration - Backend supports ALL 3 modes simultaneously
# The client (VS Code extension) will specify which mode to use per request
DEFAULT_API_MODE = get_config("api.mode", "local", _app_properties)

# Local model configuration
LOCAL_API_URL = get_config("local.api.url", "http://localhost:11434/api/generate", _app_properties)
LOCAL_MODEL_NAME = get_config("local.model.name", "deepseek-coder:6.7b", _app_properties)

# Gemini API configuration
GEMINI_API_URL = get_config("gemini.api.url", "https://generativelanguage.googleapis.com/v1beta/models", _app_properties)
GEMINI_API_KEY = get_config("gemini.api.key", "", _app_properties)
# Remove "-latest"
GEMINI_MODEL_NAME = get_config("gemini.model.name", "gemini-2.5-flash", _app_properties)

# OpenAI API configuration
OPENAI_API_URL = get_config("openai.api.url", "https://api.openai.com/v1/chat/completions", _app_properties)
OPENAI_API_KEY = get_config("openai.api.key", "", _app_properties)
OPENAI_MODEL_NAME = get_config("openai.model.name", "gpt-3.5-turbo", _app_properties)

# For backward compatibility with old "token" mode
TOKEN_API_URL = OPENAI_API_URL
TOKEN_API_KEY = OPENAI_API_KEY
TOKEN_MODEL_NAME = OPENAI_MODEL_NAME

# For backward compatibility and default values
API_MODE = DEFAULT_API_MODE
if DEFAULT_API_MODE == "gemini":
    API_URL = GEMINI_API_URL
    MODEL_NAME = GEMINI_MODEL_NAME
elif DEFAULT_API_MODE == "openai":
    API_URL = OPENAI_API_URL
    MODEL_NAME = OPENAI_MODEL_NAME
else:
    API_URL = LOCAL_API_URL
    MODEL_NAME = LOCAL_MODEL_NAME

# Indexing configuration
INDEX_PATH = get_config("index.path", "faiss_index", _app_properties)
EMBEDDING_MODEL = get_config("embedding.model", "sentence-transformers/all-MiniLM-L6-v2", _app_properties)
K_RETRIEVE = int(get_config("retrieval.k", "5", _app_properties))

# Chat configuration
MAX_TOKENS = int(get_config("chat.max.tokens", "512", _app_properties))
TEMPERATURE = float(get_config("chat.temperature", "0.3", _app_properties))
CHAT_SYSTEM_PROMPT = os.getenv(
    "CHAT_SYSTEM_PROMPT",
    "You are a code assistant. When given code:\n"
    "- Read it carefully FIRST\n"
    "- If asked to explain: explain what the code ACTUALLY does (don't invent problems)\n"
    "- If asked to modify: return the COMPLETE modified code in ```language blocks\n"
    "- Keep the same structure, class names, and method names\n"
    "- Be accurate and concise"
)
# Completion configuration
AUTOCOMPLETE_MAX_TOKENS = int(get_config("completion.max.tokens", "128", _app_properties))
COMPLETION_TEMPERATURE = float(get_config("completion.temperature", "0.0", _app_properties))
FILE_CONTEXT_MAX_CHARS = int(get_config("file.context.max.chars", "4000", _app_properties))
CODE_COMPLETION_SYSTEM_PROMPT = os.getenv(
    "CODE_COMPLETION_SYSTEM_PROMPT",
    "You complete code. Given Part A (code before cursor) and Part B (your answer):\n"
    "Part A + Part B must compile correctly.\n\n"
    "CRITICAL: Return ONLY Part B. Never include Part A in your response.\n\n"
    "Example 1:\n"
    "Part A: public void test()\n"
    "Part B: { return 42; }\n"
    "Result: public void test() { return 42; } ✓ compiles\n\n"
    "Example 2:\n"
    "Part A: int x = \n"
    "Part B: 10;\n"
    "Result: int x = 10; ✓ compiles\n\n"
    "Output ONLY Part B. Max 5 lines. No markdown, no explanations."
)

# In-memory globals
_vectorstore: Optional[FAISS] = None
_qa_chain: Optional[RetrievalQA] = None
_embeddings = None


def _truncate_text(text: str, limit: int) -> str:
    if text is None:
        return ""
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 3)] + "..."


def _extract_text_from_dict(data: Dict[str, Any]) -> Optional[str]:
    if not isinstance(data, dict):
        return None
    for key in ("completion", "text", "response", "result", "output"):
        value = data.get(key)
        if isinstance(value, str):
            return value
    nested = data.get("response")
    if isinstance(nested, dict):
        return _extract_text_from_dict(nested)
    return None


def get_api_config(api_mode: Optional[str] = None) -> tuple:
    """
    Get API configuration based on requested mode.
    Returns: (api_mode, api_url, model_name, api_key)
    """
    mode = api_mode or DEFAULT_API_MODE
    
    # Support old "token" mode for backward compatibility
    if mode == "token":
        mode = "openai"
    
    if mode == "local":
        return ("local", LOCAL_API_URL, LOCAL_MODEL_NAME, None)
    elif mode == "gemini":
        return ("gemini", GEMINI_API_URL, GEMINI_MODEL_NAME, GEMINI_API_KEY)
    elif mode == "openai":
        return ("openai", OPENAI_API_URL, OPENAI_MODEL_NAME, OPENAI_API_KEY)
    else:
        # Default to local if unknown mode
        return ("local", LOCAL_API_URL, LOCAL_MODEL_NAME, None)


def invoke_model(prompt: str, max_tokens: int, temperature: float, api_mode: Optional[str] = None) -> str:
    """Invoke the model (local or token-based) based on requested api_mode."""
    mode, api_url, model_name, api_key = get_api_config(api_mode)
    
    if mode == "local":
        # Local Ollama API
        payload = {
            "model": model_name,
            "prompt": prompt,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False,
        }
        headers = {"Content-Type": "application/json"}
        resp = requests.post(api_url, json=payload, headers=headers, timeout=120)
        resp.raise_for_status()
        try:
            data = resp.json()
        except Exception:
            return resp.text
        extracted = _extract_text_from_dict(data)
        if extracted is not None:
            return extracted
        return json.dumps(data)
    else:
        # Token-based API (OpenAI-compatible)
        payload = {
            "model": model_name,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        }
        resp = requests.post(api_url, json=payload, headers=headers, timeout=120)
        resp.raise_for_status()
        try:
            data = resp.json()
            # Extract from OpenAI format
            if "choices" in data and len(data["choices"]) > 0:
                return data["choices"][0]["message"]["content"]
        except Exception:
            return resp.text
        extracted = _extract_text_from_dict(data)
        if extracted is not None:
            return extracted
        return json.dumps(data)


# ------------------ LangChain LLM wrapper ------------------
class UnifiedLLM(LLM):
    """
    LangChain LLM wrapper that supports both local and token-based APIs.
    NOTE: fields must be declared as dataclass/pydantic fields so LangChain/Pydantic works.
    """

    api_url: str = API_URL
    model: str = MODEL_NAME
    max_tokens: int = MAX_TOKENS
    temperature: float = TEMPERATURE
    api_mode: str = API_MODE
    api_key: Optional[str] = None
    headers: Optional[Dict[str, str]] = None

    def __init__(self, **data: Any):
        super().__init__(**data)
        if self.headers is None:
            self.headers = {"Content-Type": "application/json"}
        if self.api_mode == "token" and TOKEN_API_KEY:
            self.api_key = TOKEN_API_KEY
            self.headers["Authorization"] = f"Bearer {TOKEN_API_KEY}"

    def _call(self, prompt: str, stop: Optional[List[str]] = None) -> str:
        if self.api_mode == "local":
            # Local Ollama API
            payload = {
                "model": self.model,
                "prompt": prompt,
                "max_tokens": self.max_tokens,
                "temperature": self.temperature,
                "stream": False,
            }
        else:
            # Token-based API (OpenAI-compatible)
            payload = {
                "model": self.model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": self.max_tokens,
                "temperature": self.temperature,
            }
        
        try:
            resp = requests.post(self.api_url, json=payload, headers=self.headers, timeout=60)
            resp.raise_for_status()
        except Exception as e:
            raise RuntimeError(f"Model request failed: {e}")

        # parse JSON if possible, else return raw text
        try:
            data = resp.json()
        except Exception:
            return resp.text

        # Try OpenAI format first
        if isinstance(data, dict) and "choices" in data:
            if len(data["choices"]) > 0 and "message" in data["choices"][0]:
                return data["choices"][0]["message"]["content"]
        
        # Try Ollama format
        if isinstance(data, dict):
            for key in ("completion", "text", "response", "result", "output"):
                if key in data and isinstance(data[key], str):
                    return data[key]
            # nested response
            if "response" in data and isinstance(data["response"], dict):
                for k in ("completion", "text", "output"):
                    if k in data["response"] and isinstance(data["response"][k], str):
                        return data["response"][k]
        return json.dumps(data)

    async def _acall(self, prompt: str, stop: Optional[List[str]] = None) -> str:
        # keep async contract (LangChain may call this)
        return self._call(prompt, stop)

    @property
    def _identifying_params(self) -> Dict[str, Any]:
        return {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "temperature": self.temperature,
            "api_mode": self.api_mode
        }

    @property
    def _llm_type(self) -> str:
        return f"{self.api_mode}_model"


# ------------------ Simple document loader ------------------
TEXT_EXTS = {
    ".md", ".txt", ".py", ".json", ".yaml", ".yml", ".java", ".js", ".ts", ".html",
    ".css", ".c", ".cpp", ".cs", ".go", ".rs", ".gradle", ".xml", ".sh", ".ini", ".cfg", ".csv"
}


def load_documents_from_directory(path: str) -> List[Document]:
    docs: List[Document] = []
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Documents path does not exist: {path}")

    for file in p.rglob("*"):
        if file.is_file() and file.suffix.lower() in TEXT_EXTS:
            try:
                text = file.read_text(encoding="utf-8", errors="ignore")
                metadata = {"source": str(file), "filename": file.name}
                docs.append(Document(page_content=text, metadata=metadata))
            except Exception as e:
                print(f"Warning: failed to read {file}: {e}")
    return docs


# ------------------ Embeddings + Index building ------------------
def create_embeddings():
    global _embeddings
    # prefer local HF sentence-transformers (no API key), fallback to OpenAI if required
    try:
        _embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
        # quick test call
        _ = _embeddings.embed_documents(["hello"])
        print("Using local HuggingFace embeddings:", EMBEDDING_MODEL)
    except Exception as e:
        print("HuggingFace embeddings failed:", e)
        try:
            _embeddings = OpenAIEmbeddings()
            print("Using OpenAI embeddings (ensure OPENAI_API_KEY set).")
        except Exception as e2:
            raise RuntimeError(
                "Failed to initialize embeddings. Install sentence-transformers or configure OpenAI.") from e2


def build_vectorstore_and_chain(documents: List[Document], persist_path: Optional[str] = INDEX_PATH):
    global _vectorstore, _qa_chain
    if not documents:
        raise ValueError("No documents to index.")

    create_embeddings()

    splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=150)
    chunks = splitter.split_documents(documents)

    # Build FAISS index
    _vectorstore = FAISS.from_documents(chunks, embedding=_embeddings)

    # persist index
    if persist_path:
        os.makedirs(persist_path, exist_ok=True)
        _vectorstore.save_local(persist_path)

    retriever = _vectorstore.as_retriever(search_kwargs={"k": K_RETRIEVE})
    unified_llm = UnifiedLLM()
    _qa_chain = RetrievalQA.from_chain_type(llm=unified_llm, chain_type="stuff", retriever=retriever,
                                            return_source_documents=True)
    return _qa_chain


def load_index_if_exists(persist_path: str = INDEX_PATH) -> bool:
    global _vectorstore, _qa_chain, _embeddings
    if not os.path.isdir(persist_path):
        return False
    try:
        create_embeddings()
        _vectorstore = FAISS.load_local(persist_path, _embeddings)
        retriever = _vectorstore.as_retriever(search_kwargs={"k": K_RETRIEVE})
        _qa_chain = RetrievalQA.from_chain_type(llm=UnifiedLLM(), chain_type="stuff", retriever=retriever,
                                                return_source_documents=True)
        return True
    except Exception as e:
        print("Failed to load persisted index:", e)
        return False


# ------------------ Startup: try loading or building index ------------------
@app.on_event("startup")
async def startup_event():
    global _vectorstore, _qa_chain
    try:
        if load_index_if_exists(INDEX_PATH):
            print("Loaded persisted FAISS index from", INDEX_PATH)
            return

        print("No persisted index found - building index from:", DOCUMENTS_PATH)
        docs = await run_in_threadpool(load_documents_from_directory, DOCUMENTS_PATH)
        if not docs:
            print("No documents found under path:", DOCUMENTS_PATH)
            return
        await run_in_threadpool(build_vectorstore_and_chain, docs, INDEX_PATH)
        print(f"Built index with {len(docs)} files (saved to {INDEX_PATH}).")
    except Exception:
        print("Startup indexing failed:")
        traceback.print_exc()


# ------------------ API models ------------------
class QueryRequest(BaseModel):
    query: str


class ReindexRequest(BaseModel):
    path: Optional[str] = None


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class FileReference(BaseModel):
    path: str
    content: Optional[str] = None
    language: Optional[str] = None
    start_line: Optional[int] = None
    end_line: Optional[int] = None


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    files: Optional[List[FileReference]] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    api_mode: Optional[str] = None  # "local" or "token" - overrides default


class CompletionRequest(BaseModel):
    prefix: str
    suffix: Optional[str] = ""
    language: Optional[str] = None
    file_path: Optional[str] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    related_files: Optional[List[FileReference]] = None
    api_mode: Optional[str] = None  # "local" or "token" - overrides default


def build_file_context_block(files: Optional[List[FileReference]]) -> str:
    if not files:
        print("DEBUG: No files provided")
        return ""
    
    print(f"DEBUG: Building context for {len(files)} files")
    per_file_limit = max(200, FILE_CONTEXT_MAX_CHARS // max(1, len(files)))
    blocks: List[str] = []
    
    for file_ref in files:
        content = file_ref.content or ""
        print(f"DEBUG: File {file_ref.path}, content length: {len(content)}")
        
        if not content:
            print(f"WARNING: File {file_ref.path} has no content!")
            continue
            
        snippet = _truncate_text(content, per_file_limit)
        header_parts = [file_ref.path]
        if file_ref.language:
            header_parts.append(f"[{file_ref.language}]")
        if file_ref.start_line is not None and file_ref.end_line is not None:
            header_parts.append(f"(lines {file_ref.start_line}-{file_ref.end_line})")
        header = " ".join(part for part in header_parts if part)
        blocks.append(f"{header}\n```\n{snippet}\n```".strip())
    
    result = "\n\n".join(blocks)
    print(f"DEBUG: Final file context block length: {len(result)}")
    return result


def build_chat_prompt(messages: List[ChatMessage], files: Optional[List[FileReference]]) -> str:
    """Build text prompt for local Ollama models."""
    if not messages:
        raise ValueError("Chat requires at least one message.")
    system_prompt = CHAT_SYSTEM_PROMPT
    conversation: List[str] = []
    
    # Prepend file context to the FIRST user message
    file_block = build_file_context_block(files) if files else ""
    first_user_msg_injected = False
    
    for msg in messages:
        if msg.role == "system":
            system_prompt = msg.content
            continue
        speaker = "User" if msg.role == "user" else "Assistant"
        
        # Inject file context into first user message
        if msg.role == "user" and file_block and not first_user_msg_injected:
            # Check if user is asking to explain or modify
            is_explanation = any(word in msg.content.lower() for word in ["explain", "what", "how", "why", "describe"])
            
            if is_explanation:
                enhanced_content = f"{file_block}\n\nQuestion: {msg.content}"
            else:
                # They want to modify the code
                enhanced_content = f"{file_block}\n\nModify the above code to: {msg.content}\n\nReturn the complete modified code."
            
            conversation.append(f"{speaker}: {enhanced_content}".strip())
            first_user_msg_injected = True
        else:
            conversation.append(f"{speaker}: {msg.content}".strip())
    
    if not conversation:
        raise ValueError("Chat requires at least one user or assistant message.")
    
    sections = [f"System: {system_prompt}"]
    sections.extend(conversation)
    sections.append("Assistant:")
    return "\n\n".join(sections)


def build_chat_messages_for_cloud(messages: List[ChatMessage], files: Optional[List[FileReference]]) -> List[Dict[str, str]]:
    """Build structured messages for cloud APIs (OpenAI format)."""
    if not messages:
        raise ValueError("Chat requires at least one message.")
    
    cloud_messages = []
    system_prompt = CHAT_SYSTEM_PROMPT
    file_block = build_file_context_block(files) if files else ""
    first_user_msg_injected = False
    
    for msg in messages:
        if msg.role == "system":
            system_prompt = msg.content
            continue
            
        # Inject file context into first user message
        if msg.role == "user" and file_block and not first_user_msg_injected:
            is_explanation = any(word in msg.content.lower() for word in ["explain", "what", "how", "why", "describe"])
            
            if is_explanation:
                enhanced_content = f"{file_block}\n\nQuestion: {msg.content}"
            else:
                enhanced_content = f"{file_block}\n\nModify the above code to: {msg.content}\n\nReturn the complete modified code."
            
            cloud_messages.append({"role": "user", "content": enhanced_content})
            first_user_msg_injected = True
        else:
            cloud_messages.append({"role": msg.role, "content": msg.content})
    
    # Add system message at the beginning
    if system_prompt:
        cloud_messages.insert(0, {"role": "system", "content": system_prompt})
    
    return cloud_messages


def build_gemini_messages(messages: List[ChatMessage], files: Optional[List[FileReference]]) -> Dict[str, Any]:
    """Build structured messages for Gemini API."""
    if not messages:
        raise ValueError("Chat requires at least one message.")
    
    system_prompt = CHAT_SYSTEM_PROMPT
    file_block = build_file_context_block(files) if files else ""
    first_user_msg_injected = False
    
    gemini_contents = []
    
    for msg in messages:
        if msg.role == "system":
            system_prompt = msg.content
            continue
        
        # Inject file context into first user message
        if msg.role == "user" and file_block and not first_user_msg_injected:
            is_explanation = any(word in msg.content.lower() for word in ["explain", "what", "how", "why", "describe"])
            
            if is_explanation:
                enhanced_content = f"{file_block}\n\nQuestion: {msg.content}"
            else:
                enhanced_content = f"{file_block}\n\nModify the above code to: {msg.content}\n\nReturn the complete modified code."
            
            gemini_contents.append({
                "role": "user",
                "parts": [{"text": enhanced_content}]
            })
            first_user_msg_injected = True
        else:
            # Gemini uses "user" and "model" roles
            role = "model" if msg.role == "assistant" else "user"
            gemini_contents.append({
                "role": role,
                "parts": [{"text": msg.content}]
            })
    
    # Prepend system prompt to first user message
    if system_prompt and gemini_contents:
        for content in gemini_contents:
            if content["role"] == "user":
                content["parts"][0]["text"] = f"{system_prompt}\n\n{content['parts'][0]['text']}"
                break
    
    return {"contents": gemini_contents}

def build_completion_prompt(req: CompletionRequest, for_gemini: bool = False) -> str:
    """
    Build FIM (Fill-In-Middle) prompt.
    For Gemini, add explicit instructions to only return code.
    """
    if for_gemini:
        # Gemini needs explicit instructions to return only code
        instruction = "Complete the following code. Return ONLY the code continuation, no explanations, no markdown, no backticks:\n\n"
        return instruction + req.prefix
    else:
        # For Ollama local models, just return the prefix
        return req.prefix


# ------------------ Endpoints ------------------
from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool


@app.post("/chat")
async def chat(req: ChatRequest):
    # Determine which API mode to use (from request or default)
    api_mode = req.api_mode or DEFAULT_API_MODE
    mode, api_url, model_name, api_key = get_api_config(api_mode)
    
    # Debug logging
    print(f"\n=== CHAT REQUEST DEBUG ===")
    print(f"API Mode: {mode} (model: {model_name})")
    print(f"Messages: {len(req.messages)}")
    print(f"Files received: {len(req.files) if req.files else 0}")
    if req.files:
        for f in req.files:
            content_len = len(f.content) if f.content else 0
            print(f"  - File: {f.path}")
            print(f"    Content length: {content_len}")
            print(f"    Language: {f.language}")
            print(f"    Lines: {f.start_line}-{f.end_line}")
            if content_len > 0:
                print(f"    Preview: {f.content[:100]}...")
            else:
                print(f"    WARNING: No content!")
    else:
        print("  No files attached")
    
    max_tokens = req.max_tokens or MAX_TOKENS
    max_tokens = max(64, min(max_tokens, MAX_TOKENS * 2))
    temperature = req.temperature if req.temperature is not None else TEMPERATURE

    try:
        if mode == "local":
            # Build text prompt for Ollama
            prompt = build_chat_prompt(req.messages, req.files)
            print(f"Prompt length: {len(prompt)}")
            
            payload = {
                "model": model_name,
                "prompt": prompt,
                "stream": False,
            }
            headers = {"Content-Type": "application/json"}
            resp = requests.post(api_url, json=payload, headers=headers, timeout=120)
            resp.raise_for_status()
            
            data = resp.json()
            extracted = _extract_text_from_dict(data)
            response = extracted if extracted else json.dumps(data)
            
        elif mode == "gemini":
            # Build Gemini format messages
            gemini_payload = build_gemini_messages(req.messages, req.files)
            print(f"Gemini contents: {len(gemini_payload['contents'])} messages")
            
            # Add generation config
            gemini_payload["generationConfig"] = {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
            }
            
            # Gemini uses API key in URL and model name in path
            gemini_url = f"{api_url}/{model_name}:generateContent?key={api_key}"
            headers = {"Content-Type": "application/json"}
            print(f"Gemini URL: {gemini_url.replace(api_key, 'HIDDEN_KEY')}")
            resp = requests.post(gemini_url, json=gemini_payload, headers=headers, timeout=120)
            resp.raise_for_status()
            
            data = resp.json()
            # Extract from Gemini response format
            if "candidates" in data and len(data["candidates"]) > 0:
                candidate = data["candidates"][0]
                if "content" in candidate and "parts" in candidate["content"]:
                    response = candidate["content"]["parts"][0]["text"]
                else:
                    extracted = _extract_text_from_dict(data)
                    response = extracted if extracted else json.dumps(data)
            else:
                extracted = _extract_text_from_dict(data)
                response = extracted if extracted else json.dumps(data)
            
        else:  # openai
            # Build structured messages for OpenAI API
            cloud_messages = build_chat_messages_for_cloud(req.messages, req.files)
            print(f"OpenAI messages: {len(cloud_messages)} messages")
            
            payload = {
                "model": model_name,
                "messages": cloud_messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
            }
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            }
            resp = requests.post(api_url, json=payload, headers=headers, timeout=120)
            resp.raise_for_status()
            
            data = resp.json()
            if "choices" in data and len(data["choices"]) > 0:
                response = data["choices"][0]["message"]["content"]
            else:
                extracted = _extract_text_from_dict(data)
                response = extracted if extracted else json.dumps(data)
        
        print(f"Response length: {len(response)}")
        print(f"Response preview: {response[:200]}...")
        return {"answer": response, "api_mode_used": mode, "model_used": model_name}
        
    except requests.exceptions.RequestException as e:
        print(f"Request error: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"Response status: {e.response.status_code}")
            print(f"Response body: {e.response.text}")
        raise HTTPException(status_code=500, detail=f"API request failed: {str(e)}")
    except Exception as e:
        print(f"Chat error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")


@app.post("/complete")
async def complete(req: CompletionRequest):
    # Determine which API mode to use (from request or default)
    api_mode = req.api_mode or DEFAULT_API_MODE
    mode, api_url, model_name, api_key = get_api_config(api_mode)
    
    # Debug logging
    print(f"\n=== COMPLETION REQUEST ===")
    print(f"API Mode: {mode} (model: {model_name})")
    print(f"Language: {req.language}")
    print(f"Prefix length: {len(req.prefix)}")
    
    # Build prompt (different for Gemini)
    prompt = build_completion_prompt(req, for_gemini=(mode == "gemini"))
    max_tokens = req.max_tokens or AUTOCOMPLETE_MAX_TOKENS
    max_tokens = max(16, min(max_tokens, AUTOCOMPLETE_MAX_TOKENS))
    temperature = req.temperature if req.temperature is not None else COMPLETION_TEMPERATURE

    try:
        if mode == "local":
            # Use unified model for completion (local Ollama)
            # Use /api/generate with proper options to prevent chat-like responses
            payload = {
                "model": model_name,
                "prompt": prompt,
                "stream": False,
                "raw": True,  # Disable system prompt / chat formatting
                "options": {
                    "temperature": temperature,
                    "num_predict": max_tokens,
                    "stop": ["\n\n\n", "class ", "def ", "public class", "public static"],
                    "top_p": 0.95
                }
            }
            headers = {"Content-Type": "application/json"}
            resp = requests.post(api_url, json=payload, headers=headers, timeout=30)
            resp.raise_for_status()
            
            try:
                data = resp.json()
            except Exception:
                return {"completion": resp.text.strip(), "api_mode_used": mode, "model_used": model_name}
            
            # Extract response from Ollama's format
            if isinstance(data, dict) and "response" in data:
                completion_text = data["response"].strip()
            else:
                extracted = _extract_text_from_dict(data)
                completion_text = extracted.strip() if extracted else ""
            
            return {"completion": completion_text, "api_mode_used": mode, "model_used": model_name}

        elif mode == "gemini":
            # --- NEW: GEMINI SPECIFIC LOGIC ---
            gemini_payload = {
                "contents": [{
                    "parts": [{"text": prompt}]
                }],
                "generationConfig": {
                    "temperature": temperature,
                    "maxOutputTokens": max_tokens,
                }
            }

            # Construct the specific Gemini URL
            gemini_url = f"{api_url}/{model_name}:generateContent?key={api_key}"
            headers = {"Content-Type": "application/json"}
            
            print(f"Gemini prompt preview: {prompt[:200]}...")

            resp = requests.post(gemini_url, json=gemini_payload, headers=headers, timeout=30)
            resp.raise_for_status()

            data = resp.json()
            print(f"Gemini full response: {json.dumps(data, indent=2)}")

            # Extract from Gemini response
            completion_text = ""
            if "candidates" in data and len(data["candidates"]) > 0:
                candidate = data["candidates"][0]
                print(f"Candidate: {json.dumps(candidate, indent=2)}")
                
                # Check for blocking/safety issues
                if "finishReason" in candidate:
                    print(f"Finish reason: {candidate['finishReason']}")
                
                if "content" in candidate and "parts" in candidate["content"]:
                    completion_text = candidate["content"]["parts"][0]["text"]
                elif "finishReason" in candidate and candidate["finishReason"] in ["SAFETY", "RECITATION", "OTHER"]:
                    print(f"WARNING: Content blocked by {candidate['finishReason']}")
                    # Try to get text anyway or return empty
                    completion_text = ""
            
            print(f"Gemini completion (raw): {repr(completion_text[:200] if completion_text else 'EMPTY')}")
            print(f"Gemini completion length: {len(completion_text)}")

            return {"completion": completion_text.strip(), "api_mode_used": mode, "model_used": model_name}
            
        else:  # openai
            # OpenAI API for completion
            payload = {
                "model": model_name,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_tokens,
                "temperature": temperature,
            }
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            }
            resp = requests.post(api_url, json=payload, headers=headers, timeout=30)
            resp.raise_for_status()
            
            try:
                data = resp.json()
                # Extract from OpenAI format
                if "choices" in data and len(data["choices"]) > 0:
                    completion_text = data["choices"][0]["message"]["content"].strip()
                    return {"completion": completion_text, "api_mode_used": mode, "model_used": model_name}
            except Exception:
                return {"completion": resp.text.strip(), "api_mode_used": mode, "model_used": model_name}
            
            extracted = _extract_text_from_dict(data)
            completion_text = extracted.strip() if extracted else ""
            return {"completion": completion_text, "api_mode_used": mode, "model_used": model_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Completion failed: {e}")


@app.post("/ask")
async def ask(req: QueryRequest):
    global _qa_chain
    if _qa_chain is None:
        raise HTTPException(status_code=503, detail="QA chain not initialized. Reindex or check server logs.")

    try:
        result = await run_in_threadpool(_qa_chain, {"query": req.query})

        if isinstance(result, dict):
            answer = result.get("result") or result.get("answer") or result.get("output") or ""

            sources = []
            src_docs = result.get("source_documents") or []
            for doc in src_docs:
                src = None
                snippet = None
                try:
                    src = doc.metadata.get("source") if getattr(doc, "metadata", None) else None
                    snippet = (doc.page_content or "")[:400]
                except Exception:
                    try:
                        src = doc.get("metadata", {}).get("source")
                        snippet = (doc.get("page_content") or "")[:400]
                    except Exception:
                        pass
                sources.append({"source": src, "snippet": snippet})
            return {"answer": answer, "sources": sources}

        if isinstance(result, str):
            return {"answer": result, "sources": []}

        # unexpected type
        raise HTTPException(status_code=500, detail=f"Unexpected chain result type: {type(result)}")

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query failed: {e}")


@app.post("/reindex")
async def reindex(req: ReindexRequest):
    """
    Rebuild vector index from DOCUMENTS_PATH (or provided path).
    """
    path_to_index = req.path or DOCUMENTS_PATH
    try:
        docs = await run_in_threadpool(load_documents_from_directory, path_to_index)
        if not docs:
            raise HTTPException(status_code=400, detail=f"No documents found at {path_to_index}")
        await run_in_threadpool(build_vectorstore_and_chain, docs, INDEX_PATH)
        return {"status": "ok", "indexed_files": len(docs)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reindex failed: {e}")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "indexed": _vectorstore is not None,
        "api_mode": API_MODE,
        "model": MODEL_NAME,
        "api_url": API_URL
    }


@app.get("/config")
def get_config_info():
    """Get current configuration."""
    return {
        "api_mode": API_MODE,
        "model": MODEL_NAME,
        "api_url": API_URL,
        "max_tokens": MAX_TOKENS,
        "temperature": TEMPERATURE,
        "completion_temperature": COMPLETION_TEMPERATURE,
    }


@app.get("/")
def root():
    return {
        "title": "Unified AI Code Assistant (Local + Cloud)",
        "api_mode": API_MODE,
        "model": MODEL_NAME,
        "endpoints": {
            "POST /chat": {"body": {"messages": "[{role, content}]", "files": "(optional) linked file snippets"}},
            "POST /complete": {"body": {"prefix": "text before cursor", "suffix": "(optional) text after cursor"}},
            "POST /ask": {"body": {"query": "string"}},
            "POST /reindex": {"body": {"path": "(optional) path to index"}},
            "GET /health": {},
            "GET /config": {}
        },
        "documents_path": DOCUMENTS_PATH,
        "api_url": API_URL,
    }
