import asyncio
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()  # read backend/.env for AI_API_KEY, AI_BASE_URL, AI_MODEL, etc.

app = FastAPI(title="CodeTrace Judge API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

JUDGE0_URL = os.getenv("JUDGE0_URL", "https://ce.judge0.com")
JUDGE0_TOKEN = os.getenv("JUDGE0_TOKEN", "")
LANGUAGES = {"python": 71, "javascript": 63, "java": 62, "cpp": 54}

# AI tutor (OpenAI-compatible). Key stays server-side; never sent to the client.
AI_API_KEY = os.getenv("AI_API_KEY", "")
AI_BASE_URL = os.getenv("AI_BASE_URL", "https://api.openai.com/v1")
AI_MODEL = os.getenv("AI_MODEL", "gpt-4o-mini")

# ---------------------------------------------------------------------------
# SQLite database for tracking solved problems
# ---------------------------------------------------------------------------
DB_PATH = os.path.join(os.path.dirname(__file__), "problems.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS problems (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            problem_text TEXT DEFAULT '',
            code TEXT DEFAULT '',
            language TEXT DEFAULT 'python',
            status TEXT DEFAULT 'in_progress',
            passed INTEGER DEFAULT 0,
            total INTEGER DEFAULT 0,
            tests TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Add tests column if it doesn't exist (for existing DBs)
    try:
        conn.execute("ALTER TABLE problems ADD COLUMN tests TEXT DEFAULT ''")
    except Exception:
        pass  # column already exists
    # Add stub_code column to store the original AI-generated stub (for Reset)
    try:
        conn.execute("ALTER TABLE problems ADD COLUMN stub_code TEXT DEFAULT ''")
    except Exception:
        pass  # column already exists
    conn.commit()
    conn.close()


init_db()


class RunRequest(BaseModel):
    language: str = "python"
    code: str
    stdin: str = ""


class TestCase(BaseModel):
    id: int
    input: str = ""
    expected: str = ""
    hidden: bool = False


class TestRequest(BaseModel):
    language: str = "python"
    code: str
    tests: list[TestCase]


class AIRequest(BaseModel):
    action: str  # hint | approach | explain_line | find_mistake | gen_tests | gen_stub_and_tests | gen_signature | complexity
    code: str = ""
    language: str = "python"
    problem: str = ""
    line: int | None = None
    tests: list[dict[str, Any]] | None = None
    error: str = ""


class ProblemSave(BaseModel):
    title: str
    description: str = ""
    problem_text: str = ""
    code: str = ""
    stub_code: str = ""
    language: str = "python"
    status: str = "in_progress"  # in_progress | solved | failed
    passed: int = 0
    total: int = 0
    tests: str = ""  # JSON string of test cases


@app.get("/health")
def health():
    return {"ok": True, "judge0": JUDGE0_URL, "ai": bool(AI_API_KEY)}


# ---------------------------------------------------------------------------
# Problem history endpoints
# ---------------------------------------------------------------------------

@app.get("/problems")
def list_problems():
    conn = get_db()
    rows = conn.execute(
        "SELECT id, title, status, language, passed, total, created_at, updated_at "
        "FROM problems ORDER BY updated_at DESC"
    ).fetchall()
    conn.close()
    return {"problems": [dict(r) for r in rows]}


@app.get("/problems/{problem_id}")
def get_problem(problem_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM problems WHERE id = ?", (problem_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Problem not found")
    return dict(row)


@app.post("/problems")
def save_problem(req: ProblemSave):
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO problems (title, description, problem_text, code, stub_code, language, status, passed, total, tests) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (req.title, req.description, req.problem_text, req.code, req.stub_code, req.language, req.status, req.passed, req.total, req.tests),
    )
    conn.commit()
    pid = cur.lastrowid
    conn.close()
    return {"id": pid, "ok": True}


@app.put("/problems/{problem_id}")
def update_problem(problem_id: int, req: ProblemSave):
    conn = get_db()
    row = conn.execute("SELECT id FROM problems WHERE id = ?", (problem_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Problem not found")
    conn.execute(
        "UPDATE problems SET title=?, description=?, problem_text=?, code=?, stub_code=?, language=?, "
        "status=?, passed=?, total=?, tests=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
        (req.title, req.description, req.problem_text, req.code, req.stub_code, req.language, req.status, req.passed, req.total, req.tests, problem_id),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/problems/{problem_id}")
def delete_problem(problem_id: int):
    conn = get_db()
    conn.execute("DELETE FROM problems WHERE id = ?", (problem_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


def headers():
    return {
        "Content-Type": "application/json",
        **({"X-Auth-Token": JUDGE0_TOKEN} if JUDGE0_TOKEN else {}),
    }


async def submit(language: str, code: str, stdin: str = "") -> dict[str, Any]:
    if language not in LANGUAGES:
        raise HTTPException(400, "Unsupported language")
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"{JUDGE0_URL}/submissions?base64_encoded=false&wait=false",
            headers=headers(),
            json={
                "language_id": LANGUAGES[language],
                "source_code": code,
                "stdin": stdin,
                "cpu_time_limit": 3,
                "wall_time_limit": 5,
                "memory_limit": 128000,
            },
        )
        if r.status_code >= 400:
            raise HTTPException(r.status_code, r.text[:500])
        token = r.json()["token"]
        for _ in range(40):
            await asyncio.sleep(0.25)
            rr = await client.get(
                f"{JUDGE0_URL}/submissions/{token}?base64_encoded=false",
                headers=headers(),
            )
            if rr.status_code >= 400:
                raise HTTPException(rr.status_code, rr.text[:500])
            data = rr.json()
            if data.get("status", {}).get("id", 1) > 2:
                return data
    raise HTTPException(504, "Execution timed out")


def normalized(s: str) -> str:
    s = "\n".join(line.rstrip() for line in (s or "").strip().splitlines()).strip()
    # Normalize whitespace in list/dict/tuple representations:
    # "[1, 2]" → "[1,2]", "{1: 2}" → "{1:2}", etc.
    s = s.replace(", ", ",").replace("[ ", "[").replace(" ]", "]")
    s = s.replace("{ ", "{").replace(" }", "}").replace("( ", "(").replace(" )", ")")
    return s


def result_payload(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": data.get("status", {}).get("description"),
        "stdout": data.get("stdout") or "",
        "stderr": data.get("stderr") or data.get("compile_output") or data.get("message") or "",
        "time": data.get("time"),
        "memory": data.get("memory"),
    }


@app.post("/run")
async def run(req: RunRequest):
    return result_payload(await submit(req.language, req.code, req.stdin))


@app.post("/test")
async def test(req: TestRequest):
    if not req.tests:
        raise HTTPException(400, "Add at least one test case")
    results = []
    for t in req.tests:
        data = await submit(req.language, req.code, t.input)
        actual = normalized(data.get("stdout") or "")
        expected = normalized(t.expected)
        err = data.get("stderr") or data.get("compile_output") or data.get("message") or ""
        results.append(
            {
                "id": t.id,
                "input": t.input,
                "expected": expected,
                "actual": actual,
                "hidden": t.hidden,
                "passed": (actual == expected and not err),
                "error": err,
                "time": data.get("time"),
                "memory": data.get("memory"),
            }
        )
    passed = sum(r["passed"] for r in results)
    return {"passed": passed, "total": len(results), "results": results}


# ---------------------------------------------------------------------------
# Local Python tracer (fast, no network). Emits typed values + call stack.
# ---------------------------------------------------------------------------

TRACER_TEMPLATE = r'''
import sys, json, traceback

__CT_STEPS = []
__CT_STACK = []  # list of func names
__CT_FILE = __file__
__CT_OFFSET = 0  # 1-based file line of the first user code line

def __ct_value(v):
    """Return a JSON-serializable, typed description of a local variable."""
    try:
        if isinstance(v, (int, float, bool, str)) or v is None:
            t = type(v).__name__
            return {"type": t, "value": v if not isinstance(v, bool) else v}
        if isinstance(v, (list, tuple)):
            return {"type": "list", "value": [__ct_value(x) for x in v]}
        if isinstance(v, set):
            return {"type": "set", "value": [__ct_value(x) for x in sorted(v, key=repr)]}
        if isinstance(v, dict):
            return {"type": "dict", "value": [
                {"key": __ct_value(k), "val": __ct_value(val)} for k, val in v.items()
            ]}
        # Generic object with attributes (e.g. ListNode, TreeNode)
        attrs = {}
        try:
            for name in vars(v):
                if not name.startswith("_"):
                    attrs[name] = __ct_value(getattr(v, name))
        except TypeError:
            attrs = {}
        return {"type": type(v).__name__, "value": attrs, "repr": repr(v)}
    except Exception:
        return {"type": "unknown", "value": None, "repr": "<unserializable>"}


def __ct_locals(frame):
    out = {}
    for k, v in frame.f_locals.items():
        if k.startswith("__") or k.startswith("_CT") or k.startswith("__ct"):
            continue
        out[k] = __ct_value(v)
    return out


def __trace(frame, event, arg):
    try:
        fname = frame.f_code.co_filename
        if fname != __CT_FILE:
            return __trace
        func = frame.f_code.co_name
        # Skip tracer-internal helper frames so they don't pollute the trace.
        if func.startswith("__ct") or func == "__trace":
            return __trace
        if event == "call":
            __CT_STACK.append(func)
            return __trace
        if event == "return":
            if __CT_STACK:
                __CT_STACK.pop()
            return __trace
        if event == "line":
            __CT_STEPS.append({
                "line": frame.f_lineno - __CT_OFFSET + 1,
                "locals": __ct_locals(frame),
                "callStack": list(__CT_STACK),
                "event": "line",
            })
    except Exception:
        pass
    return __trace


sys.settrace(__trace)
try:
__BODY__
finally:
    sys.settrace(None)
    sys.stdout.flush()
    sys.stdout.write("__CODETRACE__" + json.dumps(__CT_STEPS, default=repr))
'''


def _build_traced_source(user_code: str, stdin: str) -> str:
    body = "\n".join("    " + line for line in user_code.splitlines() or ["pass"])
    tpl_lines = TRACER_TEMPLATE.splitlines()
    offset = next(i for i, ln in enumerate(tpl_lines) if "__BODY__" in ln) + 1  # 1-based
    src = TRACER_TEMPLATE.replace("__BODY__", body).replace("__CT_OFFSET = 0", f"__CT_OFFSET = {offset}")
    return src


@app.post("/visualize")
async def visualize(req: RunRequest):
    if req.language != "python":
        # Non-Python visualization isn't supported by the local tracer.
        raise HTTPException(
            400,
            "Step-by-step visualization currently supports Python. "
            "Run/Submit supports Python, JavaScript, Java and C++.",
        )
    src = _build_traced_source(req.code, req.stdin)
    loop = asyncio.get_event_loop()
    steps, stdout, stderr, status = await loop.run_in_executor(
        None, _run_python_locally, src, req.stdin
    )
    return {
        "status": status,
        "stdout": stdout.strip(),
        "stderr": stderr,
        "steps": steps,
    }


def _run_python_locally(src: str, stdin: str) -> tuple[list, str, str, str]:
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".py", delete=False, encoding="utf-8"
        ) as f:
            f.write(src)
            path = f.name
        try:
            proc = subprocess.run(
                [sys.executable, path],
                input=stdin,
                capture_output=True,
                text=True,
                timeout=8,
            )
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass
        out = proc.stdout or ""
        err = proc.stderr or ""
        steps: list = []
        marker = "__CODETRACE__"
        if marker in out:
            out, raw = out.split(marker, 1)
            try:
                steps = json.loads(raw.strip())
            except json.JSONDecodeError:
                pass
        # Drop tracer-internal noise (File "<string>" wrapper frames) but keep
        # real error messages so users see runtime errors clearly.
        err_lines = [
            ln for ln in err.splitlines()
            if ln and 'File "<string>"' not in ln and 'File "<run>"' not in ln
        ]
        clean_err = "\n".join(err_lines).strip()
        status = "Accepted" if proc.returncode == 0 else (
            "Runtime Error" if proc.returncode and proc.returncode > 0 else "Finished"
        )
        if proc.returncode != 0 and clean_err:
            status = "Runtime Error"
        return steps, out, clean_err, status
    except subprocess.TimeoutExpired:
        return [], "", "", "Time Limit Exceeded"
    except Exception as e:  # pragma: no cover
        return [], "", str(e), "Internal Error"


# ---------------------------------------------------------------------------
# AI tutor (OpenAI-compatible chat completions). Key stays on the server.
# ---------------------------------------------------------------------------

AI_SYSTEM = (
    "You are CodeTrace's AI tutor for DSA practice. Be concise and pedagogical. "
    "For hints, give the smallest useful nudge, not the full answer unless asked. "
    "When explaining, reference line numbers when provided. "
    "For generated test cases, return ONLY a JSON array of objects with "
    "'input' and 'expected' string fields, no prose."
)


def _ai_prompt(req: AIRequest) -> str:
    try:
        if req.action == "hint":
            return (
                f"Problem:\n{req.problem}\n\nUser's code ({req.language}):\n{req.code}\n\n"
                "Give one small hint toward the right approach without revealing the full solution. "
                "2-3 sentences max."
            )
        if req.action == "approach":
            return (
                f"Problem:\n{req.problem}\n\nExplain a good approach to solve this "
                "(intuition + algorithm + time/space complexity). Do not write full code."
            )
        if req.action == "explain_line":
            return (
                f"Code ({req.language}):\n{req.code}\n\nExplain what line {req.line} does "
                "in the context of this solution. 1-2 sentences."
            )
        if req.action == "find_mistake":
            return (
                f"Problem:\n{req.problem}\n\nUser's code ({req.language}):\n{req.code}\n\n"
                f"Runtime/error info: {req.error}\n\nFind the bug. Point to the line and "
                "explain the fix briefly. If the code is correct, say so."
            )
        if req.action == "gen_tests":
            return (
                f"Problem:\n{req.problem}\n\nFunction signature context: {req.code[:600]}\n\n"
                "Generate 5 diverse test cases (edge cases included). "
                "Return ONLY a JSON array of {\"input\": \"...\", \"expected\": \"...\"}."
            )
        if req.action == "gen_stub_and_tests":
            return (
                f"Problem:\n{req.problem}\n\n"
                "Generate a Python solution stub AND test cases for this problem.\n"
                "Return ONLY a JSON object (no prose, no markdown fences) with this exact shape:\n"
                "{\n"
                '  "function_name": "camelCaseName",\n'
                '  "params": [{"name": "param1", "type": "int|str|List[int]|bool|float"}, ...],\n'
                '  "test_cases": [{"input": "param1 = value1, param2 = value2", "expected": "expected_output"}, ...]\n'
                "}\n\n"
                "Rules:\n"
                "- function_name: descriptive camelCase, derived from the problem (e.g. 'addTwoNumbers', 'longestSubstring', 'maxCoins')\n"
                "- params: infer from the problem description. Use 'a', 'b' for unnamed inputs.\n"
                '- test_cases: 3-5 cases including edge cases. input must use "name = value" format parseable by ast.literal_eval.\n'
                '- expected: string representation of the expected output (e.g. "3", "[0,1]", "true", "\\"abc\\"").\n'
            )
        if req.action == "gen_signature":
            return (
                f"Problem:\n{req.problem}\n\n"
                "Identify the correct Python function signature for this problem.\n"
                "Return ONLY a JSON object (no prose, no markdown fences) with this exact shape:\n"
                "{\n"
                '  "title": "Human Readable Title In Title Case",\n'
                '  "function_name": "camelCaseName",\n'
                '  "params": [{"name": "param1", "type": "int|str|List[int]|List[List[int]]|bool|float|object"}, ...]\n'
                "}\n\n"
                "Rules:\n"
                "- title: a clean, human-readable title in Title Case (e.g. 'Time Needed to Inform All Employees', 'Two Sum', 'Longest Palindromic Substring'). Derive it from the problem description, NOT the function name.\n"
                "- function_name: descriptive camelCase, derived from the problem (e.g. 'addTwoNumbers', 'longestSubstring', 'maxCoins')\n"
                "- params: infer the correct parameter names and types from the problem description.\n"
                "  Use the variable names mentioned in the problem (e.g. 'coins', 'k', 'nums', 'target', 's').\n"
                "  If no names are given, use 'a', 'b', etc.\n"
                "- Do NOT include test cases — only the title and function signature.\n"
            )
        if req.action == "complexity":
            return (
                f"Analyze time and space complexity of this {req.language} code:\n{req.code}\n\n"
                "Give Big-O with a one-line justification each."
            )
        return "Help the user with their DSA problem."
    except Exception:
        return "Help the user with their DSA problem."


@app.post("/ai")
async def ai(req: AIRequest):
    if not AI_API_KEY:
        raise HTTPException(
            503,
            "AI tutor is not configured. Set AI_API_KEY (and optionally AI_BASE_URL, "
            "AI_MODEL) on the backend to enable it.",
        )
    payload = {
        "model": AI_MODEL,
        "messages": [
            {"role": "system", "content": AI_SYSTEM},
            {"role": "user", "content": _ai_prompt(req)},
        ],
        "temperature": 0.3,
    }
    try:
        async with httpx.AsyncClient(timeout=40) as client:
            r = await client.post(
                f"{AI_BASE_URL.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {AI_API_KEY}"},
                json=payload,
            )
            if r.status_code >= 400:
                raise HTTPException(r.status_code, r.text[:500])
            data = r.json()
            msg = data["choices"][0]["message"]["content"]
            # Strip markdown code fences for JSON-returning actions
            if req.action in ("gen_tests", "gen_stub_and_tests", "gen_signature"):
                msg = _strip_code_fences(msg)
            return {"text": msg, "action": req.action}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"AI request failed: {e}")


def _strip_code_fences(text: str) -> str:
    """Remove markdown ```json ... ``` fences, returning just the inner content."""
    import re
    # Match ```json\n...\n``` or ```\n...\n```
    m = re.search(r"```(?:json)?\s*\n?([\s\S]*?)\n?```", text)
    if m:
        return m.group(1).strip()
    return text.strip()
