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

app = FastAPI(title="RAG over Local Files + Ollama (LangChain)")

# ------------------ CONFIG (hardcoded path as requested) ------------------
DOCUMENTS_PATH = "/Users/siddarthalegala/Documents/Hackathon/fastapi/fastapi/"
OLLAMA_API_URL = os.getenv("OLLAMA_API_URL", "http://localhost:11434/api/generate")
# For better chat responses, consider: mistral, llama2, or codellama:13b
# CodeLlama 7B is code-focused but not great at following complex instructions
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "codellama:7b")
OLLAMA_COMPLETION_MODEL = os.getenv("OLLAMA_COMPLETION_MODEL", "deepseek-coder:6.7b")
INDEX_PATH = os.getenv("INDEX_PATH", "faiss_index")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
K_RETRIEVE = int(os.getenv("K_RETRIEVE", "5"))
MAX_TOKENS = int(os.getenv("MAX_TOKENS", "512"))
TEMPERATURE = float(os.getenv("TEMPERATURE", "0.3"))  # Add some randomness for chat
CHAT_SYSTEM_PROMPT = os.getenv(
    "CHAT_SYSTEM_PROMPT",
    "You are a code assistant. When given code:\n"
    "- Read it carefully FIRST\n"
    "- If asked to explain: explain what the code ACTUALLY does (don't invent problems)\n"
    "- If asked to modify: return the COMPLETE modified code in ```language blocks\n"
    "- Keep the same structure, class names, and method names\n"
    "- Be accurate and concise"
)
FILE_CONTEXT_MAX_CHARS = int(os.getenv("FILE_CONTEXT_MAX_CHARS", "4000"))
AUTOCOMPLETE_MAX_TOKENS = int(os.getenv("AUTOCOMPLETE_MAX_TOKENS", "128"))
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


def invoke_ollama(prompt: str, max_tokens: int, temperature: float) -> str:
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": False,
    }
    headers = {"Content-Type": "application/json"}
    resp = requests.post(OLLAMA_API_URL, json=payload, headers=headers, timeout=120)
    resp.raise_for_status()
    try:
        data = resp.json()
    except Exception:
        return resp.text
    extracted = _extract_text_from_dict(data)
    if extracted is not None:
        return extracted
    return json.dumps(data)


# ------------------ Small Ollama LangChain LLM wrapper ------------------
class OllamaLangChain(LLM):
    """
    LangChain LLM wrapper for Ollama HTTP API.
    NOTE: fields must be declared as dataclass/pydantic fields so LangChain/Pydantic works.
    """

    api_url: str = OLLAMA_API_URL
    model: str = OLLAMA_MODEL
    max_tokens: int = MAX_TOKENS
    temperature: float = TEMPERATURE
    headers: Optional[Dict[str, str]] = None

    def __init__(self, **data: Any):
        super().__init__(**data)
        if self.headers is None:
            self.headers = {"Content-Type": "application/json"}

    def _call(self, prompt: str, stop: Optional[List[str]] = None) -> str:
        payload = {
            "model": self.model,
            "prompt": prompt,
            "max_tokens": self.max_tokens,
            "temperature": self.temperature,
            "stream": False,
        }
        try:
            resp = requests.post(self.api_url, json=payload, headers=self.headers, timeout=60)
            resp.raise_for_status()
        except Exception as e:
            raise RuntimeError(f"Ollama request failed: {e}")

        # parse JSON if possible, else return raw text
        try:
            data = resp.json()
        except Exception:
            return resp.text

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
        return {"model": self.model, "max_tokens": self.max_tokens, "temperature": self.temperature}

    @property
    def _llm_type(self) -> str:
        return "ollama"


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
    ollama_llm = OllamaLangChain()
    _qa_chain = RetrievalQA.from_chain_type(llm=ollama_llm, chain_type="stuff", retriever=retriever,
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
        _qa_chain = RetrievalQA.from_chain_type(llm=OllamaLangChain(), chain_type="stuff", retriever=retriever,
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


class CompletionRequest(BaseModel):
    prefix: str
    suffix: Optional[str] = ""
    language: Optional[str] = None
    file_path: Optional[str] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    related_files: Optional[List[FileReference]] = None


def build_file_context_block(files: Optional[List[FileReference]]) -> str:
    if not files:
        return ""
    per_file_limit = max(200, FILE_CONTEXT_MAX_CHARS // max(1, len(files)))
    blocks: List[str] = []
    for file_ref in files:
        snippet = _truncate_text(file_ref.content or "", per_file_limit)
        header_parts = [file_ref.path]
        if file_ref.language:
            header_parts.append(f"[{file_ref.language}]")
        if file_ref.start_line is not None and file_ref.end_line is not None:
            header_parts.append(f"(lines {file_ref.start_line}-{file_ref.end_line})")
        header = " ".join(part for part in header_parts if part)
        blocks.append(f"{header}\n```\n{snippet}\n```".strip())
    return "\n\n".join(blocks)


def build_chat_prompt(messages: List[ChatMessage], files: Optional[List[FileReference]]) -> str:
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


def build_completion_prompt(req: CompletionRequest) -> str:
    """
    Build FIM (Fill-In-Middle) prompt.
    Try raw concatenation - just prefix without special tokens
    """
    # DeepSeek-Coder in Ollama might not support FIM tokens properly
    # Try simpler approach: just give it the prefix and let it continue
    return req.prefix


# ------------------ Endpoints ------------------
from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool


@app.post("/chat")
async def chat(req: ChatRequest):
    # Debug logging
    print(f"\n=== CHAT REQUEST DEBUG ===")
    print(f"Messages: {len(req.messages)}")
    print(f"Files received: {len(req.files) if req.files else 0}")
    if req.files:
        for f in req.files:
            print(f"  - {f.path}: content_length={len(f.content or '')}")
    
    try:
        prompt = build_chat_prompt(req.messages, req.files)
        print(f"Prompt length: {len(prompt)}")
        print(f"Prompt preview:\n{prompt[:800]}...")
        print(f"Prompt end:\n...{prompt[-400:]}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    max_tokens = req.max_tokens or MAX_TOKENS
    max_tokens = max(64, min(max_tokens, MAX_TOKENS * 2))
    # Use provided temperature or default (now 0.3 for variety)
    temperature = req.temperature if req.temperature is not None else TEMPERATURE

    try:
        response = await run_in_threadpool(invoke_ollama, prompt, max_tokens, temperature)
        print(f"Response length: {len(response)}")
        print(f"Response preview: {response[:200]}...")
        return {"answer": response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat failed: {e}")


@app.post("/complete")
async def complete(req: CompletionRequest):
    prompt = build_completion_prompt(req)
    max_tokens = req.max_tokens or AUTOCOMPLETE_MAX_TOKENS
    max_tokens = max(16, min(max_tokens, AUTOCOMPLETE_MAX_TOKENS))
    temperature = req.temperature if req.temperature is not None else 0.0

    try:
        # Use dedicated completion model (DeepSeek-Coder)
        # Use /api/generate with proper options to prevent chat-like responses
        payload = {
            "model": OLLAMA_COMPLETION_MODEL,
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
        resp = requests.post(OLLAMA_API_URL, json=payload, headers=headers, timeout=30)
        resp.raise_for_status()
        
        try:
            data = resp.json()
        except Exception:
            return {"completion": resp.text.strip()}
        
        # Extract response from Ollama's format
        if isinstance(data, dict) and "response" in data:
            completion_text = data["response"].strip()
        else:
            extracted = _extract_text_from_dict(data)
            completion_text = extracted.strip() if extracted else ""
        
        return {"completion": completion_text}
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
    return {"status": "ok", "indexed": _vectorstore is not None}


@app.get("/")
def root():
    return {
        "title": "RAG over Local Files + Ollama",
        "endpoints": {
            "POST /chat": {"body": {"messages": "[{role, content}]", "files": "(optional) linked file snippets"}},
            "POST /complete": {"body": {"prefix": "text before cursor", "suffix": "(optional) text after cursor"}},
            "POST /ask": {"body": {"query": "string"}},
            "POST /reindex": {"body": {"path": "(optional) path to index"}},
            "GET /health": {}
        },
        "documents_path": DOCUMENTS_PATH,
        "ollama_api": OLLAMA_API_URL,
    }
