/**
 * Structural analysis script for Python submissions. Run as `python3 -c <this>`
 * with the student's source on stdin. The student code is only PARSED
 * (`ast.parse`), never executed. Emits one JSON line on stdout; exit code 0.
 */
export const PYTHON_ANALYZER_SCRIPT = String.raw`
import ast, json, sys

FORBIDDEN_CALLS = {"eval": "eval()", "exec": "exec()", "__import__": "__import__()", "compile": "compile()"}
FORBIDDEN_ATTR = {("os", "system"): ("os_system", "os.system()"), ("os", "popen"): ("os_popen", "os.popen()")}
FORBIDDEN_IMPORTS = {"subprocess": ("subprocess", "the subprocess module")}


class A(ast.NodeVisitor):
    def __init__(self):
        self.fn = 0
        self.loops = 0
        self.branches = 0
        self.max_fn_len = 0
        self.max_depth = 0
        self.d = 0
        self.recursion = False
        self.findings = {}
        self.stack = []

    def add(self, i, k, l, det=""):
        self.findings.setdefault(i, {"id": i, "kind": k, "label": l, "detail": det})

    def enter(self):
        self.d += 1
        self.max_depth = max(self.max_depth, self.d)

    def leave(self):
        self.d -= 1

    def visit_If(self, n):
        self.branches += 1
        self.enter(); self.generic_visit(n); self.leave()

    def _loop(self, n, kind):
        self.loops += 1
        self.add("uses_loop", "info", "uses a loop")
        self.add("uses_" + kind, "info", "uses a " + kind + "-loop")
        if kind == "while":
            t = n.test
            is_true = (isinstance(t, ast.Constant) and t.value is True) or (isinstance(t, ast.Name) and t.id == "True")
            has_break = any(isinstance(c, ast.Break) for c in ast.walk(n))
            if is_true and not has_break:
                self.add("while_true_no_break", "forbidden", "while True with no break", "unbounded loop")
        self.enter(); self.generic_visit(n); self.leave()

    def visit_For(self, n):
        self._loop(n, "for")

    visit_AsyncFor = visit_For

    def visit_While(self, n):
        self._loop(n, "while")

    def visit_With(self, n):
        self.enter(); self.generic_visit(n); self.leave()

    visit_AsyncWith = visit_With

    def visit_Try(self, n):
        self.branches += 1
        for h in n.handlers:
            if h.type is None:
                self.add("bare_except", "forbidden", "bare 'except:'", "catches every exception")
        self.enter(); self.generic_visit(n); self.leave()

    def visit_BoolOp(self, n):
        self.branches += 1
        self.generic_visit(n)

    def visit_IfExp(self, n):
        self.branches += 1
        self.generic_visit(n)

    def _comp(self, n):
        self.add("uses_comprehension", "info", "uses a comprehension")
        self.generic_visit(n)

    visit_ListComp = _comp
    visit_SetComp = _comp
    visit_DictComp = _comp
    visit_GeneratorExp = _comp

    def _fn(self, n):
        self.fn += 1
        self.add("defines_function", "info", "defines a function")
        length = (getattr(n, "end_lineno", n.lineno) or n.lineno) - n.lineno + 1
        self.max_fn_len = max(self.max_fn_len, length)
        if length > 50:
            self.add("long_function", "quality", "a function is over 50 lines", n.name + " is " + str(length) + " lines")
        self.stack.append(n.name)
        self.enter(); self.generic_visit(n); self.leave()
        self.stack.pop()

    visit_FunctionDef = _fn
    visit_AsyncFunctionDef = _fn

    def visit_ClassDef(self, n):
        self.enter(); self.generic_visit(n); self.leave()

    def visit_Import(self, n):
        for a in n.names:
            root = a.name.split(".")[0]
            if root in FORBIDDEN_IMPORTS:
                i, l = FORBIDDEN_IMPORTS[root]
                self.add(i, "forbidden", l, "imports " + a.name)
        self.generic_visit(n)

    def visit_ImportFrom(self, n):
        root = (n.module or "").split(".")[0]
        if root in FORBIDDEN_IMPORTS:
            i, l = FORBIDDEN_IMPORTS[root]
            self.add(i, "forbidden", l, "imports from " + str(n.module))
        self.generic_visit(n)

    def visit_Call(self, n):
        f = n.func
        if isinstance(f, ast.Name):
            if f.id in FORBIDDEN_CALLS:
                self.add(f.id, "forbidden", FORBIDDEN_CALLS[f.id], "calls " + FORBIDDEN_CALLS[f.id])
            if self.stack and f.id == self.stack[-1]:
                self.recursion = True
                self.add("uses_recursion", "info", "uses recursion")
        elif isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name):
            key = (f.value.id, f.attr)
            if key in FORBIDDEN_ATTR:
                i, l = FORBIDDEN_ATTR[key]
                self.add(i, "forbidden", l, "calls " + l)
        self.generic_visit(n)


src = sys.stdin.read()
try:
    tree = ast.parse(src)
except SyntaxError as e:
    print(json.dumps({"ok": False, "error": "SyntaxError: " + str(e.msg) + " (line " + str(e.lineno) + ")"}))
    sys.exit(0)
except Exception as e:
    print(json.dumps({"ok": False, "error": type(e).__name__ + ": " + str(e)}))
    sys.exit(0)

a = A()
a.visit(tree)
metrics = {
    "lineCount": len(src.splitlines()),
    "functionCount": a.fn,
    "maxFunctionLength": a.max_fn_len,
    "branchCount": a.branches,
    "loopCount": a.loops,
    "maxNestingDepth": a.max_depth,
    "hasRecursion": a.recursion,
}
print(json.dumps({"ok": True, "metrics": metrics, "findings": list(a.findings.values())}))
`;
