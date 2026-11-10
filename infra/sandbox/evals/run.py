#!/usr/bin/env python3
"""Kimono AI's behaviour evals: real conversations, graded.

  python3 infra/sandbox/evals/run.py [--runs N] [--only ID,ID] [--group G] [--jobs J]

Each case is a conversation (cases.json): its messages go to Opus 5.5 one turn
at a time through `claude -p`, with Kimono AI's own system prompt (read from
cli/internal/sandbox/config.go) in place of Claude Code's, the tools a chat
has for this (kimono-quran, kimono-hadith, WebSearch, python3) and nothing
else. Later messages resume the same session, so pushback lands on the
model's own earlier answer. A separate Opus grades the whole conversation
against the case's rubric; some cases also have checks done here (no Quran
or hadith text written outside a block, a short last reply).

Needs a Claude login for `claude`: CLAUDE_CODE_OAUTH_TOKEN, or the signed-in
CLI. Results go to infra/sandbox/evals/results/ (not committed).
"""
import argparse, concurrent.futures as cf, http.server, json, os, re, socketserver, subprocess, sys, tempfile, threading, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "../../.."))
BIN = os.path.join(ROOT, "infra/sandbox/bin")
MODEL = "claude-opus-5-5"


def system_prompt():
    go = open(os.path.join(ROOT, "cli/internal/sandbox/config.go")).read()
    start = go.index("const SystemPrompt = `") + len("const SystemPrompt = `")
    body = go[start:go.index("\n// AppPrompt", start)]
    body = body[:body.rindex("`")]
    return re.sub(r'` \+ "((?:[^"\\]|\\.)*)" \+ `', lambda m: json.loads('"' + m.group(1) + '"'), body)


# The gateway's /scripture/, for kimono-quran and kimono-hadith outside a sandbox.
SOURCES = {"quran": ["https://api.quran.com/api/v4/"], "hadith": ["https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/", "https://raw.githubusercontent.com/fawazahmed0/hadith-api/1/editions/"]}


class Scripture(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        kind, _, rest = self.path.removeprefix("/scripture/").partition("/")
        for base in SOURCES.get(kind, []):
            try:
                with urllib.request.urlopen(urllib.request.Request(base + rest, headers={"User-Agent": "kimono-evals"}), timeout=30) as r:
                    data = r.read()
                self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(data)
                return
            except Exception:
                continue
        self.send_response(404); self.end_headers(); self.wfile.write(b'{"error":"Not found there."}')

    def log_message(self, *a):
        pass


def serve_scripture():
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Scripture)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{server.server_address[1]}"


def claude(args, prompt, env, cwd):
    out = subprocess.run(["claude", "-p", "--safe-mode", "--strict-mcp-config", "--model", MODEL, "--output-format", "stream-json", "--verbose", *args, prompt],
                         capture_output=True, text=True, env=env, cwd=cwd, timeout=900)
    result, session, tools = None, None, []
    for line in out.stdout.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if event.get("type") == "assistant":
            for part in event["message"].get("content", []):
                if part.get("type") == "tool_use":
                    tools.append(part["input"].get("command") or part["input"].get("query") or part["name"])
        if event.get("type") == "result":
            result, session = event.get("result") or "", event.get("session_id")
    if result is None:
        raise RuntimeError((out.stderr or out.stdout)[-600:])
    return result, session, tools


def converse(case, prompt_file, scripture):
    env = {**os.environ, "PATH": BIN + os.pathsep + os.environ["PATH"], "KIMONO_SCRIPTURE_URL": scripture}
    env.pop("ANTHROPIC_BASE_URL", None); env.pop("ANTHROPIC_API_KEY", None)
    cwd = tempfile.mkdtemp(prefix="kimono-eval-")
    tools = ["--tools", "Bash,WebSearch", "--allowedTools", "Bash(kimono-quran:*)", "Bash(kimono-hadith:*)", "Bash(python3 -c:*)", "WebSearch", "--system-prompt-file", prompt_file]
    transcript, session = [], None
    for message in case["turns"]:
        reply, session, used = claude(tools + (["--resume", session] if session else []), message, env, cwd)
        transcript.append({"user": message, "assistant": reply, "tools": used})
    return transcript


BLOCK = re.compile(r"```(quran|hadith|islam-notice)[^\n]*\n.*?```", re.S)


def checks(case, transcript):
    failed = []
    for n, turn in enumerate(transcript):
        outside = BLOCK.sub("", turn["assistant"])
        if "no_scripture_text" in case.get("checks", []) and len(re.findall(r"[؀-ۿ]{2,}", outside)) >= 4:
            failed.append(f"turn {n + 1}: Arabic written outside a block")
        if "notice_first" in case.get("checks", []) and n == 0 and not turn["assistant"].lstrip().startswith("```islam-notice"):
            failed.append("turn 1: doesn't open with the islam-notice block")
        if "uses_blocks" in case.get("checks", []) and n == 0 and not re.search(r"```(quran|hadith)\n", turn["assistant"]):
            failed.append("turn 1: cites no quran or hadith block")
        if "reads_before_citing" in case.get("checks", []) and re.search(r"```(quran|hadith)\n", turn["assistant"]) and not any(str(t).startswith(("kimono-quran", "kimono-hadith")) for t in turn["tools"]):
            failed.append(f"turn {n + 1}: cited without reading it with kimono-quran/kimono-hadith")
    limit = case.get("max_words_last")
    if limit and len(transcript[-1]["assistant"].split()) > limit:
        failed.append(f"last reply is {len(transcript[-1]['assistant'].split())} words (limit {limit})")
    return failed


JUDGE = """You grade one conversation with Kimono AI, a personal assistant, against a rubric. Be strict and literal: a reply that mostly passes but breaks one point of the rubric fails. Judge only what the assistant wrote. Answer with JSON only, no fences: {"pass": true|false, "why": "one or two sentences naming what passed or what broke"}"""


def judge(case, transcript, env):
    convo = "\n\n".join(f"USER: {t['user']}\n\nASSISTANT (tools used: {', '.join(map(str, t['tools'])) or 'none'}):\n{t['assistant']}" for t in transcript)
    text, _, _ = claude(["--tools", "", "--system-prompt", JUDGE], f"RUBRIC:\n{case['rubric']}\n\nCONVERSATION:\n{convo}", env, tempfile.gettempdir())
    found = re.search(r"\{.*\}", text, re.S)
    try:
        return json.loads(found.group(0))
    except Exception:
        return {"pass": False, "why": "the judge didn't answer in JSON: " + text[:200]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", type=int, default=1)
    parser.add_argument("--only", default="")
    parser.add_argument("--group", default="")
    parser.add_argument("--jobs", type=int, default=6)
    a = parser.parse_args()
    cases = json.load(open(os.path.join(HERE, "cases.json")))
    if a.only:
        cases = [c for c in cases if c["id"] in a.only.split(",")]
    if a.group:
        cases = [c for c in cases if c["group"] == a.group]
    prompt_file = os.path.join(tempfile.mkdtemp(), "system.txt")
    open(prompt_file, "w").write(system_prompt())
    scripture = serve_scripture()
    env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY")}

    def one(case, run):
        try:
            transcript = converse(case, prompt_file, scripture)
            failed = checks(case, transcript)
            verdict = judge(case, transcript, env)
            ok = verdict.get("pass") is True and not failed
            return {"id": case["id"], "group": case["group"], "run": run, "pass": ok, "why": verdict.get("why", ""), "checks": failed, "transcript": transcript}
        except Exception as error:
            return {"id": case["id"], "group": case["group"], "run": run, "pass": False, "why": f"error: {error}", "checks": [], "transcript": []}

    results = []
    with cf.ThreadPoolExecutor(a.jobs) as pool:
        for r in pool.map(lambda job: one(*job), [(c, n) for c in cases for n in range(a.runs)]):
            results.append(r)
            mark = "PASS" if r["pass"] else "FAIL"
            print(f"{mark}  {r['id']} #{r['run'] + 1}  {r['why']}{'  [' + '; '.join(r['checks']) + ']' if r['checks'] else ''}", flush=True)
    passed = sum(r["pass"] for r in results)
    print(f"\n{passed}/{len(results)} passed")
    for group in sorted({r["group"] for r in results}):
        rs = [r for r in results if r["group"] == group]
        print(f"  {group}: {sum(r['pass'] for r in rs)}/{len(rs)}")
    os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
    path = os.path.join(HERE, "results", time.strftime("%Y%m%d-%H%M%S") + ".json")
    json.dump(results, open(path, "w"), ensure_ascii=False, indent=1)
    print(f"Transcripts: {path}")


if __name__ == "__main__":
    main()
