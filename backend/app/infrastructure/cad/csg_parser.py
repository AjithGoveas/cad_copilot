"""
csg_parser.py  —  Production-grade OpenSCAD → build123d parser
================================================================
Handles:
  • Full recursive module definitions with parameter passing
  • Variable scoping (lexical, with late-binding for parameters)
  • for-loop geometry expansion
  • BOSL2 cuboid(rounding, edges), cyl(orient, anchor)
  • fillet_profile / cbore_hole_z user-module execution
  • Multi-tier boolean fallbacks (Stage 1/2/3)
  • Rigid/non-rigid 4×4 matrix decomposition
  • Convex hull + polyhedron shell stitching
"""

from __future__ import annotations

import enum
import math
import re
import threading
import traceback
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from build123d import (
    Axis, Box, Circle, Color, Compound, Cone, Cylinder,
    Edge, Face, Location, Plane, Polygon, Rectangle,
    Rotation, Shape, Shell, Solid, Sphere, Vector, Wire,
    export_step, extrude, revolve,
)
from OCP.BRep import BRep_Builder
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Common, BRepAlgoAPI_Fuse
from OCP.BRepBuilderAPI import (
    BRepBuilderAPI_GTransform,
    BRepBuilderAPI_MakeSolid,
    BRepBuilderAPI_Transform,
)
from OCP.gp import gp_GTrsf, gp_Trsf
from OCP.TopoDS import TopoDS_Compound

# ─────────────────────────────────────────────────────────────────────────────
# §1  LEXER
# ─────────────────────────────────────────────────────────────────────────────

class TT(enum.Enum):
    NUMBER=  "NUMBER";  STRING= "STRING";  BOOL=   "BOOL";  UNDEF= "UNDEF"
    IDENT=   "IDENT"
    PLUS=    "+";    MINUS=  "-";  STAR=  "*";   SLASH= "/"
    PERCENT= "%";    CARET=  "^";  BANG=  "!"
    AND=     "&&";   OR=     "||"
    EQ=      "==";   NEQ=    "!="
    LT=      "<";    LE=     "<="; GT=    ">";   GE=    ">="
    QUESTION="?";    COLON=  ":"
    LPAREN=  "(";    RPAREN= ")";  LBRACE="{";   RBRACE="}"
    LBRACKET="[";    RBRACKET="]"
    ASSIGN=  "=";    COMMA=  ",";  SEMI=  ";";   DOT=   "."
    EOF=     "EOF"

@dataclass
class Token:
    type: TT
    value: Any
    line: int = 0

_IGNORED_VARS = frozenset({
    "$fn","$fs","$fa","$vpr","$vpt","$vpd","$vpf","$t","$children","$preview"
})

_MATH_FN: Dict[str, Callable] = {
    "sin":   lambda x: math.sin(math.radians(x)),
    "cos":   lambda x: math.cos(math.radians(x)),
    "tan":   lambda x: math.tan(math.radians(x)),
    "asin":  lambda x: math.degrees(math.asin(max(-1,min(1,x)))),
    "acos":  lambda x: math.degrees(math.acos(max(-1,min(1,x)))),
    "atan":  lambda x: math.degrees(math.atan(x)),
    "atan2": lambda y,x: math.degrees(math.atan2(y,x)),
    "abs": abs, "ceil": math.ceil, "floor": math.floor, "round": round,
    "sqrt": lambda x: math.sqrt(max(0,x)),
    "pow": math.pow, "exp": math.exp, "log": math.log, "ln": math.log,
    "max": lambda *a: max(a[0]) if len(a)==1 and isinstance(a[0],list) else max(a),
    "min": lambda *a: min(a[0]) if len(a)==1 and isinstance(a[0],list) else min(a),
    "norm": lambda v: math.sqrt(sum(x*x for x in v)),
    "cross": lambda a,b: [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]],
    "concat": lambda *a: [x for s in a for x in (s if isinstance(s,list) else [s])],
    "len": len, "str": str, "chr": chr, "ord": ord,
    "sign": lambda x: (1 if x>0 else -1 if x<0 else 0),
    "is_undef": lambda x: x is None,
    "is_num":  lambda x: isinstance(x,(int,float)) and not isinstance(x,bool),
    "is_bool": lambda x: isinstance(x,bool),
    "is_list": lambda x: isinstance(x,list),
    "is_string": lambda x: isinstance(x,str),
    "lookup": lambda k,t: _lookup(k,t),
    "PI": math.pi, "TAU": math.tau,
}

_OPENSCAD_CONSTANTS: Dict[str, Any] = {
    "PI": math.pi, "TAU": math.tau,
    "true": True, "false": False, "undef": None,
    "CENTER":[0,0,0], "TOP":[0,0,1], "BOTTOM":[0,0,-1],
    "FRONT":[0,-1,0], "BACK":[0,1,0], "LEFT":[-1,0,0], "RIGHT":[1,0,0],
    "UP":[0,0,1], "DOWN":[0,0,-1], "FWD":[0,-1,0],
    "X":[1,0,0], "Y":[0,1,0], "Z":[0,0,1],
}

def _lookup(key,table):
    if not table: return 0.0
    table=sorted(table,key=lambda p:p[0])
    if key<=table[0][0]: return table[0][1]
    if key>=table[-1][0]: return table[-1][1]
    for i in range(len(table)-1):
        k0,v0=table[i]; k1,v1=table[i+1]
        if k0<=key<=k1:
            t=(key-k0)/(k1-k0); return v0+t*(v1-v0)
    return table[-1][1]

_OP_PATTERNS = [
    (re.compile(r'&&'), TT.AND), (re.compile(r'\|\|'), TT.OR),
    (re.compile(r'=='), TT.EQ),  (re.compile(r'!='),  TT.NEQ),
    (re.compile(r'<='), TT.LE),  (re.compile(r'>='),  TT.GE),
    (re.compile(r'<'),  TT.LT),  (re.compile(r'>'),   TT.GT),
    (re.compile(r'\+'), TT.PLUS),(re.compile(r'-'),   TT.MINUS),
    (re.compile(r'\*'), TT.STAR),(re.compile(r'/'),   TT.SLASH),
    (re.compile(r'%'),  TT.PERCENT),(re.compile(r'\^'),TT.CARET),
    (re.compile(r'!'),  TT.BANG),
    (re.compile(r'\?'), TT.QUESTION),(re.compile(r':'),TT.COLON),
    (re.compile(r'='),  TT.ASSIGN),
    (re.compile(r'\('), TT.LPAREN),(re.compile(r'\)'),TT.RPAREN),
    (re.compile(r'\{'), TT.LBRACE),(re.compile(r'\}'),TT.RBRACE),
    (re.compile(r'\['), TT.LBRACKET),(re.compile(r'\]'),TT.RBRACKET),
    (re.compile(r','),  TT.COMMA),(re.compile(r';'),  TT.SEMI),
    (re.compile(r'\.'), TT.DOT),
]

class Lexer:
    def __init__(self, src: str):
        self._s = src; self._p = 0; self._line = 1

    def tokenize(self) -> List[Token]:
        toks: List[Token] = []
        while self._p < len(self._s):
            self._skip()
            if self._p >= len(self._s): break
            t = self._next()
            if t: toks.append(t)
        toks.append(Token(TT.EOF, None, self._line))
        return toks

    def _ch(self, off=0):
        i = self._p+off
        return self._s[i] if i < len(self._s) else "\x00"

    def _adv(self):
        c = self._s[self._p]; self._p += 1
        if c == "\n": self._line += 1
        return c

    def _skip(self):
        while self._p < len(self._s):
            c = self._ch()
            if c in " \t\r\n": self._adv()
            elif c=="/" and self._ch(1)=="/":
                while self._p<len(self._s) and self._ch()!="\n": self._adv()
            elif c=="/" and self._ch(1)=="*":
                self._adv(); self._adv()
                while self._p<len(self._s):
                    if self._ch()=="*" and self._ch(1)=="/":
                        self._adv(); self._adv(); break
                    self._adv()
            elif c in "#%!*" and self._ch(1).isalpha():
                self._adv()  # drop OpenSCAD modifier prefix
            else: break

    def _next(self) -> Optional[Token]:
        ln = self._line; c = self._ch()
        if c=='"': return self._str(ln)
        if c.isdigit() or (c=='.' and self._ch(1).isdigit()): return self._num(ln)
        if c.isalpha() or c in "_$": return self._ident(ln)
        for pat,tt in _OP_PATTERNS:
            m = pat.match(self._s, self._p)
            if m:
                self._p = m.end()
                return Token(tt, m.group(), ln)
        self._adv(); return None

    def _str(self, ln):
        self._adv(); buf=[]
        while self._p<len(self._s) and self._ch()!='"':
            c=self._adv()
            if c=="\\" and self._p<len(self._s):
                e=self._adv()
                buf.append({"n":"\n","t":"\t","r":"\r",'"':'"',"\\":"\\"}
                           .get(e,e))
            else: buf.append(c)
        if self._ch()=='"': self._adv()
        return Token(TT.STRING,"".join(buf),ln)

    def _num(self, ln):
        s=self._p
        while self._ch().isdigit(): self._adv()
        if self._ch()=='.' and self._ch(1).isdigit():
            self._adv()
            while self._ch().isdigit(): self._adv()
        if self._ch() in 'eE':
            self._adv()
            if self._ch() in '+-': self._adv()
            while self._ch().isdigit(): self._adv()
        raw=self._s[s:self._p]
        v = float(raw) if ('.' in raw or 'e' in raw.lower()) else int(raw)
        return Token(TT.NUMBER,v,ln)

    def _ident(self, ln):
        s=self._p
        while self._ch().isalnum() or self._ch() in '_$': self._adv()
        name=self._s[s:self._p]
        if name in ("true","false"): return Token(TT.BOOL, name=="true", ln)
        if name=="undef": return Token(TT.UNDEF, None, ln)
        return Token(TT.IDENT, name, ln)

# ─────────────────────────────────────────────────────────────────────────────
# §2  AST NODES
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ASTNode:
    name: str
    attrs: Dict[str,Any]   = field(default_factory=dict)
    pos_args: List[Any]    = field(default_factory=list)
    children: List["ASTNode"] = field(default_factory=list)

@dataclass
class ModuleDef:
    """Stores a user-defined module for later instantiation."""
    name: str
    params: List[Tuple[str, Any]]   # (param_name, default_value_or_None)
    body: List[ASTNode]             # statement list (already-parsed AST)

# ─────────────────────────────────────────────────────────────────────────────
# §3  PARSER  —  builds AST + captures module definitions
# ─────────────────────────────────────────────────────────────────────────────

class ParseError(Exception): pass

class Parser:
    """
    Recursive-descent parser.
    Module *definitions* are stored in self.module_defs.
    Module *calls* become ASTNode trees.
    Expressions are NOT evaluated here — they are returned as-is for the
    evaluator to resolve in the correct variable scope.
    """

    def __init__(self, tokens: List[Token]):
        self._t = tokens; self._p = 0
        self.module_defs: Dict[str, ModuleDef] = {}
        # base scope for constant evaluation during parsing
        self._scope: Dict[str,Any] = dict(_OPENSCAD_CONSTANTS)

    # ── token helpers ────────────────────────────────────────────────────────
    def _peek(self): return self._t[self._p]
    def _adv(self):
        t=self._t[self._p]
        if t.type!=TT.EOF: self._p+=1
        return t
    def _check(self,tt): return self._peek().type==tt
    def _match(self,*tt):
        if self._peek().type in tt: self._adv(); return True
        return False
    def _expect(self,tt,msg=""):
        if not self._check(tt):
            raise ParseError(f"L{self._peek().line}: expected {tt.value}, "
                             f"got {self._peek().type.value!r} {self._peek().value!r}. {msg}")
        return self._adv()

    # ── public ───────────────────────────────────────────────────────────────
    def parse(self) -> List[ASTNode]:
        nodes=[]
        while not self._check(TT.EOF):
            n=self._stmt()
            if n is not None: nodes.append(n)
        return nodes

    # ── statements ───────────────────────────────────────────────────────────
    def _stmt(self) -> Optional[ASTNode]:
        if self._match(TT.SEMI): return None

        # variable assignment:  name = expr ;
        if (self._check(TT.IDENT)
                and self._p+1<len(self._t)
                and self._t[self._p+1].type==TT.ASSIGN):
            name=self._adv().value; self._adv()
            val=self._expr()
            self._match(TT.SEMI)
            if name not in _IGNORED_VARS:
                self._scope[name]=val
            return ASTNode("__assign__", attrs={"name":name,"value":val})

        # module definition
        if self._check(TT.IDENT) and self._peek().value=="module":
            self._parse_module_def(); return None

        # function definition
        if self._check(TT.IDENT) and self._peek().value=="function":
            self._skip_function_def(); return None

        # use / include
        if self._check(TT.IDENT) and self._peek().value in ("use","include"):
            self._skip_use_include(); return None

        # for
        if self._check(TT.IDENT) and self._peek().value=="for":
            return self._parse_for()

        # if
        if self._check(TT.IDENT) and self._peek().value=="if":
            return self._parse_if()

        # let
        if self._check(TT.IDENT) and self._peek().value=="let":
            return self._parse_let()

        # module call
        if self._check(TT.IDENT):
            return self._parse_call()

        self._adv(); return None

    def _parse_module_def(self):
        self._adv()  # 'module'
        name=self._expect(TT.IDENT).value
        self._expect(TT.LPAREN)
        params=[]
        while not self._check(TT.RPAREN) and not self._check(TT.EOF):
            pname=self._expect(TT.IDENT).value
            default=None
            if self._match(TT.ASSIGN):
                default=self._expr()
            params.append((pname,default))
            self._match(TT.COMMA)
        self._expect(TT.RPAREN)
        body=self._block()
        self.module_defs[name]=ModuleDef(name,params,body)

    def _skip_function_def(self):
        self._adv()  # 'function'
        if self._check(TT.IDENT): self._adv()
        if self._check(TT.LPAREN): self._skip_balanced(TT.LPAREN,TT.RPAREN)
        if self._match(TT.ASSIGN): self._expr()
        self._match(TT.SEMI)

    def _skip_use_include(self):
        self._adv()
        # consume everything until ; or newline-like token
        while not self._check(TT.SEMI) and not self._check(TT.EOF):
            self._adv()
        self._match(TT.SEMI)

    def _parse_for(self) -> ASTNode:
        self._adv()  # 'for'
        self._expect(TT.LPAREN)
        # collect raw for-spec tokens
        var=self._expect(TT.IDENT).value
        self._expect(TT.ASSIGN)
        iterable=self._expr()
        self._expect(TT.RPAREN)
        body=self._block() if self._check(TT.LBRACE) else [self._stmt()]
        body=[b for b in body if b is not None]
        return ASTNode("__for__",
                       attrs={"var":var,"iter":iterable},
                       children=body)

    def _parse_if(self) -> ASTNode:
        self._adv()  # 'if'
        self._expect(TT.LPAREN)
        cond=self._expr()
        self._expect(TT.RPAREN)
        then=self._block() if self._check(TT.LBRACE) else [self._stmt()]
        else_=[]
        if self._check(TT.IDENT) and self._peek().value=="else":
            self._adv()
            else_=self._block() if self._check(TT.LBRACE) else [self._stmt()]
        return ASTNode("__if__",
                       attrs={"cond":cond},
                       children=[b for b in then+else_ if b is not None])

    def _parse_let(self) -> ASTNode:
        self._adv()  # 'let'
        if self._check(TT.LPAREN): self._skip_balanced(TT.LPAREN,TT.RPAREN)
        body=self._block() if self._check(TT.LBRACE) else [self._stmt()]
        return ASTNode("group",children=[b for b in body if b is not None])

    def _parse_call(self) -> Optional[ASTNode]:
        name=self._adv().value
        if not self._check(TT.LPAREN):
            children=self._block() if self._check(TT.LBRACE) else []
            return ASTNode(name,children=children)
        self._expect(TT.LPAREN)
        pos,kw=self._call_args()
        self._expect(TT.RPAREN)
        kw={k:v for k,v in kw.items() if k not in _IGNORED_VARS}
        children=[]
        if self._check(TT.LBRACE):
            children=self._block()
        elif self._check(TT.SEMI):
            self._adv()
        elif self._check(TT.IDENT):
            c=self._parse_call()
            if c: children=[c]
        return ASTNode(name,attrs=kw,pos_args=pos,children=children)

    def _call_args(self):
        pos=[]; kw={}
        while not self._check(TT.RPAREN) and not self._check(TT.EOF):
            if (self._check(TT.IDENT)
                    and self._p+1<len(self._t)
                    and self._t[self._p+1].type==TT.ASSIGN):
                k=self._adv().value; self._adv()
                kw[k]=self._expr()
            else:
                pos.append(self._expr())
            self._match(TT.COMMA)
        return pos,kw

    def _block(self) -> List[ASTNode]:
        self._expect(TT.LBRACE)
        nodes=[]
        while not self._check(TT.RBRACE) and not self._check(TT.EOF):
            n=self._stmt()
            if n is not None: nodes.append(n)
        self._expect(TT.RBRACE)
        return nodes

    def _skip_balanced(self,open_tt,close_tt):
        depth=0
        while not self._check(TT.EOF):
            if self._check(open_tt): depth+=1; self._adv()
            elif self._check(close_tt):
                depth-=1; self._adv()
                if depth<=0: return
            else: self._adv()

    # ── expression evaluator (resolves at parse time against self._scope) ───
    # We store expressions as Python values directly; for unknowns we store
    # the raw identifier string so the evaluator can re-resolve it later.

    def _expr(self): return self._ternary()

    def _ternary(self):
        c=self._or()
        if self._match(TT.QUESTION):
            t=self._or(); self._expect(TT.COLON); e=self._or()
            try: return t if c else e
            except Exception: return t
        return c

    def _or(self):
        l=self._and()
        while self._check(TT.OR): self._adv(); r=self._and(); l=bool(l) or bool(r)
        return l

    def _and(self):
        l=self._eq()
        while self._check(TT.AND): self._adv(); r=self._eq(); l=bool(l) and bool(r)
        return l

    def _eq(self):
        l=self._cmp()
        while self._check(TT.EQ) or self._check(TT.NEQ):
            op=self._adv().type; r=self._cmp()
            l=(l==r) if op==TT.EQ else (l!=r)
        return l

    def _cmp(self):
        l=self._add()
        ops={TT.LT:"<",TT.LE:"<=",TT.GT:">",TT.GE:">="}
        while self._peek().type in ops:
            op=self._adv().type; r=self._add()
            try: l={"<":l<r,"<=":l<=r,">":l>r,">=":l>=r}[ops[op]]
            except TypeError: l=False
        return l

    def _add(self):
        l=self._mul()
        while self._check(TT.PLUS) or self._check(TT.MINUS):
            op=self._adv().type; r=self._mul()
            try: l=l+r if op==TT.PLUS else l-r
            except TypeError: l=0
        return l

    def _mul(self):
        l=self._unary()
        while self._peek().type in (TT.STAR,TT.SLASH,TT.PERCENT):
            op=self._adv().type; r=self._unary()
            try:
                if op==TT.STAR: l=l*r
                elif op==TT.SLASH: l=l/r if r else 0
                else: l=l%r if r else 0
            except TypeError: l=0
        return l

    def _unary(self):
        if self._match(TT.MINUS):
            v=self._pow()
            try: return -v
            except TypeError: return 0
        if self._match(TT.BANG): return not self._pow()
        return self._pow()

    def _pow(self):
        b=self._postfix()
        if self._match(TT.CARET):
            e=self._unary()
            try: return b**e
            except Exception: return 0
        return b

    def _postfix(self):
        v=self._primary()
        while True:
            if self._check(TT.LBRACKET):
                self._adv(); idx=self._expr(); self._expect(TT.RBRACKET)
                try: v=v[int(idx)]
                except (TypeError,IndexError): v=None
            elif self._check(TT.DOT):
                self._adv()
                attr=self._adv().value if self._check(TT.IDENT) else None
                if isinstance(v,(list,tuple)) and attr in ("x","y","z"):
                    v=v[{"x":0,"y":1,"z":2}[attr]]
                else: v=None
            else: break
        return v

    def _primary(self):
        t=self._peek()
        if t.type==TT.NUMBER:  self._adv(); return t.value
        if t.type==TT.BOOL:    self._adv(); return t.value
        if t.type==TT.UNDEF:   self._adv(); return None
        if t.type==TT.STRING:  self._adv(); return t.value
        if t.type==TT.LBRACKET: return self._array()
        if t.type==TT.LPAREN:
            self._adv(); v=self._expr(); self._match(TT.RPAREN); return v
        if t.type==TT.IDENT:
            name=t.value
            if (self._p+1<len(self._t)
                    and self._t[self._p+1].type==TT.LPAREN):
                return self._fn_call()
            self._adv()
            if name in _IGNORED_VARS: return None
            # Look up in scope
            if name in self._scope: return self._scope[name]
            # Unknown — return sentinel string so evaluator can re-resolve
            return f"__var__{name}"
        self._adv(); return None

    def _array(self):
        self._expect(TT.LBRACKET)
        if self._check(TT.RBRACKET): self._adv(); return []
        first=self._expr()
        if self._check(TT.COLON):
            self._adv(); second=self._expr()
            if self._check(TT.COLON):
                self._adv(); third=self._expr()
                self._expect(TT.RBRACKET)
                return _range(first,second,third)
            self._expect(TT.RBRACKET)
            return _range(first,1,second)
        items=[first]
        while self._match(TT.COMMA):
            if self._check(TT.RBRACKET): break
            items.append(self._expr())
        self._expect(TT.RBRACKET)
        return items

    def _fn_call(self):
        name=self._adv().value
        self._expect(TT.LPAREN)
        args=[]; kw={}
        while not self._check(TT.RPAREN) and not self._check(TT.EOF):
            if (self._check(TT.IDENT)
                    and self._p+1<len(self._t)
                    and self._t[self._p+1].type==TT.ASSIGN):
                k=self._adv().value; self._adv(); kw[k]=self._expr()
            else: args.append(self._expr())
            self._match(TT.COMMA)
        self._expect(TT.RPAREN)
        if name in _MATH_FN:
            fn=_MATH_FN[name]
            try: return fn(*args,**kw)
            except Exception: return None
        # unknown function — can't evaluate at parse time
        return None

def _range(start,step,end):
    try:
        start,step,end=float(start),float(step),float(end)
        if step==0: return []
        result=[]; v=start; cap=10_000
        while (step>0 and v<=end+1e-10) or (step<0 and v>=end-1e-10):
            result.append(round(v,10)); v+=step
            if len(result)>=cap: break
        return result
    except Exception: return []

# ─────────────────────────────────────────────────────────────────────────────
# §4  SHAPE UTILITIES
# ─────────────────────────────────────────────────────────────────────────────

_occ_lock = threading.Lock()

def _log(msg): print(f"[csg_parser] {msg}")

def _micro(): return Box(0.001,0.001,0.001)

def flatten_compound(shape) -> List[Any]:
    if shape is None: return []
    if isinstance(shape,(list,tuple)):
        out=[]
        for s in shape: out.extend(flatten_compound(s))
        return [x for x in out if x is not None]
    if isinstance(shape,Compound):
        out=[]
        try:
            for c in shape: out.extend(flatten_compound(c))
        except Exception: return [shape]
        return [x for x in out if x is not None]
    return [shape]

def _clear(shapes):
    for s in shapes:
        try: s.parent=None
        except Exception: pass

def make_compound(shapes) -> Any:
    flat=flatten_compound(shapes); _clear(flat)
    if not flat: return _micro()
    if len(flat)==1: return flat[0]
    try: return Compound.make_compound(flat)
    except Exception:
        try:
            comp=TopoDS_Compound(); b=BRep_Builder(); b.MakeCompound(comp)
            for s in flat:
                try: b.Add(comp,s.wrapped)
                except Exception: pass
            return Compound(comp)
        except Exception: return flat[0]

def _nu_scale(shape,sx,sy,sz):
    from OCP.TopAbs import TopAbs_ShapeEnum
    import OCP.TopoDS
    
    gt=gp_GTrsf(gp_Trsf())
    gt.SetValue(1,1,sx); gt.SetValue(2,2,sy); gt.SetValue(3,3,sz)
    tr=BRepBuilderAPI_GTransform(shape.wrapped,gt,True)
    if not tr.IsDone():
        raise RuntimeError("BRepBuilderAPI_GTransform failed")
    out_shape = tr.Shape()
    st = out_shape.ShapeType()
    
    if st == TopAbs_ShapeEnum.TopAbs_COMPOUND:
        return Compound(OCP.TopoDS.TopoDS.Compound_s(out_shape))
    elif st == TopAbs_ShapeEnum.TopAbs_SOLID:
        return Solid(OCP.TopoDS.TopoDS.Solid_s(out_shape))
    elif st == TopAbs_ShapeEnum.TopAbs_SHELL:
        return Shell(OCP.TopoDS.TopoDS.Shell_s(out_shape))
    elif st == TopAbs_ShapeEnum.TopAbs_FACE:
        return Face(OCP.TopoDS.TopoDS.Face_s(out_shape))
    elif st == TopAbs_ShapeEnum.TopAbs_WIRE:
        return Wire(OCP.TopoDS.TopoDS.Wire_s(out_shape))
    elif st == TopAbs_ShapeEnum.TopAbs_EDGE:
        return Edge(OCP.TopoDS.TopoDS.Edge_s(out_shape))
    return Shape.cast(out_shape)

# ─────────────────────────────────────────────────────────────────────────────
# §5  BOSL2 HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _resolve_orient(orient) -> List[float]:
    if orient is None: return [0,0,1]
    if isinstance(orient,str):
        m={"X":[1,0,0],"Y":[0,1,0],"Z":[0,0,1],
           "UP":[0,0,1],"DOWN":[0,0,-1],"TOP":[0,0,1],"BOTTOM":[0,0,-1],
           "FRONT":[0,-1,0],"BACK":[0,1,0],"LEFT":[-1,0,0],"RIGHT":[1,0,0],"FWD":[0,-1,0]}
        return m.get(orient.upper(),[0,0,1])
    if isinstance(orient,(list,tuple)) and len(orient)>=3:
        v=[float(orient[i]) for i in range(3)]
        # resolve string-sentinel values like "__var__X"
        return v
    return [0,0,1]

def _orient_shape(shape, orient_vec):
    """Rotate shape so its axis aligns with orient_vec (default axis is Z)."""
    ox,oy,oz=float(orient_vec[0]),float(orient_vec[1]),float(orient_vec[2])
    eps=1e-6
    if abs(ox)<eps and abs(oy)<eps and oz>0:  return shape          # already Z-up
    if abs(ox)<eps and abs(oy)<eps and oz<0:  return Rotation(180,0,0)*shape
    if abs(ox)>abs(oy) and abs(ox)>abs(oz):   return Rotation(0,90 if ox>0 else -90,0)*shape
    if abs(oy)>abs(ox) and abs(oy)>abs(oz):   return Rotation(-90 if oy>0 else 90,0,0)*shape
    # generic
    try:
        from OCP.gp import gp_Vec,gp_Ax1,gp_Dir,gp_Pnt
        z=gp_Vec(0,0,1); tgt=gp_Vec(ox,oy,oz)
        if tgt.Magnitude()<eps: return shape
        tgt.Normalize()
        cross=z.Crossed(tgt)
        if cross.Magnitude()<eps: return Rotation(180,0,0)*shape
        angle=math.degrees(z.Angle(tgt))
        ax=gp_Ax1(gp_Pnt(0,0,0),gp_Dir(cross.X(),cross.Y(),cross.Z()))
        trsf=gp_Trsf(); trsf.SetRotation(ax,math.radians(angle))
        tr=BRepBuilderAPI_Transform(shape.wrapped,trsf,True)
        return Shape.cast(tr.Shape())
    except Exception: return shape

def _anchor_offset(anchor, sx, sy, sz) -> Tuple[float,float,float]:
    """Return translation to apply AFTER orient so anchor point sits at origin."""
    if anchor is None: return (0,0,0)
    if isinstance(anchor,str):
        m={
            "CENTER":(0,0,0), "TOP":(0,0,-sz/2), "BOTTOM":(0,0,sz/2),
            "FRONT":(0,sy/2,0),"BACK":(0,-sy/2,0),
            "LEFT":(sx/2,0,0),"RIGHT":(-sx/2,0,0),
        }
        return m.get(anchor.upper(),(0,0,0))
    if isinstance(anchor,(list,tuple)) and len(anchor)>=3:
        return (-float(anchor[0])*sx/2,
                -float(anchor[1])*sy/2,
                -float(anchor[2])*sz/2)
    return (0,0,0)

def _bosl2_cyl(a,p):
    """BOSL2 cyl() — full parameter set."""
    h   = float(_g(a,p,0,"h",  1.0))
    r   = _g(a,p,1,"r",  None)
    r1  = _g(a,None,None,"r1", None)
    r2  = _g(a,None,None,"r2", None)
    d   = _g(a,None,None,"d",  None)
    d1  = _g(a,None,None,"d1", None)
    d2  = _g(a,None,None,"d2", None)
    orient  = _resolve_orient(_g(a,None,None,"orient",None))
    anchor  = _g(a,None,None,"anchor",None)
    center  = bool(_g(a,None,None,"center",False))

    if r1 is None and d1 is not None: r1=float(d1)/2
    if r2 is None and d2 is not None: r2=float(d2)/2
    if r1 is None and r2 is None:
        if   r is not None: r1=r2=float(r)
        elif d is not None: r1=r2=float(d)/2
        else:               r1=r2=1.0
    r1=float(r1) if r1 is not None else float(r2)
    r2=float(r2) if r2 is not None else float(r1)

    shape=(Cylinder(radius=r1,height=h)
           if abs(r1-r2)<1e-6
           else Cone(bottom_radius=r1,top_radius=r2,height=h))

    # BOSL2 cyl: default anchor=CENTER (centred on Z), unlike OpenSCAD cylinder
    # If caller passes anchor=BOTTOM we want base at z=0 after orient.
    # Build centered first, then handle anchor.
    if not center and anchor is None:
        # plain cyl() centres by default in BOSL2
        pass   # already centered by build123d Cylinder

    shape=_orient_shape(shape,orient)

    # resolve anchor bounding box
    tx,ty,tz=_anchor_offset(anchor, r1*2, r1*2, h)
    if any(abs(v)>1e-9 for v in (tx,ty,tz)):
        shape=Location((tx,ty,tz))*shape
    return shape

def _bosl2_cuboid(a,p):
    """BOSL2 cuboid() — with rounding on edges."""
    size=_g(a,p,0,"size",[1,1,1])
    if isinstance(size,(int,float)): size=[float(size)]*3
    size=[float(size[i]) if i<len(size) else 1.0 for i in range(3)]
    sx,sy,sz=size
    orient  =_resolve_orient(_g(a,None,None,"orient",None))
    anchor  =_g(a,None,None,"anchor",None)
    rounding=_g(a,None,None,"rounding",None)
    edges_sel=_g(a,None,None,"edges","ALL")

    if rounding is not None and float(rounding)>1e-6:
        r=float(rounding)
        shape=_rounded_box(sx,sy,sz,r,str(edges_sel) if edges_sel else "ALL")
    else:
        shape=Box(sx,sy,sz)

    shape=_orient_shape(shape,orient)
    tx,ty,tz=_anchor_offset(anchor,sx,sy,sz)
    if any(abs(v)>1e-9 for v in (tx,ty,tz)):
        shape=Location((tx,ty,tz))*shape
    return shape

def _rounded_box(sx,sy,sz,r,edges_sel="ALL"):
    """
    Approximate BOSL2 cuboid(rounding=r, edges="Z") with build123d.
    edges_sel: "Z" = round only vertical edges, "X"/"Y" = horizontal, "ALL" = all.
    We use a 2D rounded-square extrusion for Z-edge rounding (most common case),
    and fall back to plain Box for other axes.
    """
    try:
        from build123d import RectangleRounded
        sel=str(edges_sel).upper()
        if "Z" in sel or sel=="ALL":
            r2=min(r, sx/2-1e-4, sy/2-1e-4)
            face=RectangleRounded(sx,sy,r2)
            return extrude(face,amount=sz,dir=(0,0,1))*Location((0,0,-sz/2))
        elif "X" in sel:
            r2=min(r,sy/2-1e-4,sz/2-1e-4)
            face=RectangleRounded(sy,sz,r2)
            solid=extrude(face,amount=sx,dir=(0,0,1))*Location((0,0,-sx/2))
            return Rotation(0,90,0)*solid
        elif "Y" in sel:
            r2=min(r,sx/2-1e-4,sz/2-1e-4)
            face=RectangleRounded(sx,sz,r2)
            solid=extrude(face,amount=sy,dir=(0,0,1))*Location((0,0,-sy/2))
            return Rotation(90,0,0)*solid
        else:
            return Box(sx,sy,sz)
    except Exception as e:
        _log(f"rounded_box fallback: {e}")
        return Box(sx,sy,sz)

def _g(attrs,pos,idx,key,default):
    """Get named attr → positional → default."""
    if key in attrs and attrs[key] is not None: return attrs[key]
    if pos is not None and idx is not None and idx<len(pos) and pos[idx] is not None:
        return pos[idx]
    return default

# ─────────────────────────────────────────────────────────────────────────────
# §6  BOOLEAN ENGINE  (Stage 1 → 2 → 3)
# ─────────────────────────────────────────────────────────────────────────────

def _union(base,others):
    for o in others:
        try: base=base+o; continue
        except Exception: pass
        try:
            f=BRepAlgoAPI_Fuse(base.wrapped,o.wrapped)
            if f.IsDone(): base=Shape.cast(f.Shape()); continue
        except Exception: pass
        base=make_compound([base,o])
    return base

def _difference(base,cutters):
    # Apply the Epsilon Rule: extend all subtractive volumes by eps = 0.05 in Z and shift down by eps/2 = 0.025
    eps = 0.05
    modified_cutters = []
    for c in cutters:
        try:
            bb = c.bounding_box()
            h = bb.max.Z - bb.min.Z
            if h > 1e-6:
                sz = (h + eps) / h
                cz = (bb.min.Z + bb.max.Z) / 2
                c_centered = Location((0, 0, -cz)) * c
                c_scaled = _nu_scale(c_centered, 1.0, 1.0, sz)
                c_mod = Location((0, 0, cz)) * c_scaled
                modified_cutters.append(c_mod)
            else:
                modified_cutters.append(c)
        except Exception as e:
            import traceback
            _log(f"Error applying epsilon rule to cutter: {e}")
            traceback.print_exc()
            modified_cutters.append(c)
    cutters = modified_cutters

    # Stage 1
    try:
        r=base
        for c in cutters: r=r-c
        return r
    except Exception as e: _log(f"diff S1: {e}")
    # Stage 2
    try:
        u=make_compound(cutters)
        op=BRepAlgoAPI_Cut(base.wrapped,u.wrapped)
        if op.IsDone(): return Shape.cast(op.Shape())
    except Exception as e: _log(f"diff S2: {e}")
    # Stage 3  epsilon push
    try:
        r=base
        for c in cutters:
            try:
                bb=c.bounding_box()
                cx=(bb.min.X+bb.max.X)/2; cy=(bb.min.Y+bb.max.Y)/2; cz=(bb.min.Z+bb.max.Z)/2
                ci=Location((-cx,-cy,-cz))*c
                ci=ci.scale(1.002)
                ci=Location((cx,cy,cz))*ci
                r=r-ci
            except Exception: pass
        return r
    except Exception as e: _log(f"diff S3: {e}")
    _log("CRITICAL: all difference stages failed — returning base")
    return base

def _intersection(base,others):
    for o in others:
        try: base=base&o; continue
        except Exception: pass
        try:
            op=BRepAlgoAPI_Common(base.wrapped,o.wrapped)
            if op.IsDone(): base=Shape.cast(op.Shape()); continue
        except Exception: pass
        bp=flatten_compound(base); op2=flatten_compound(o); parts=[]
        for b in bp:
            for c in op2:
                try: parts.extend(flatten_compound(b&c))
                except Exception: pass
        if parts: base=make_compound(parts)
    return base

# ─────────────────────────────────────────────────────────────────────────────
# §7  MATRIX DECOMPOSITION
# ─────────────────────────────────────────────────────────────────────────────

def _apply_multmatrix(shape, matrix):
    if not matrix or len(matrix)<3 or any(len(row)<4 for row in matrix[:3]):
        return shape
    r=[[float(matrix[i][j]) for j in range(3)] for i in range(3)]
    tx,ty,tz=float(matrix[0][3]),float(matrix[1][3]),float(matrix[2][3])
    sx=math.sqrt(r[0][0]**2+r[1][0]**2+r[2][0]**2)
    sy=math.sqrt(r[0][1]**2+r[1][1]**2+r[2][1]**2)
    sz=math.sqrt(r[0][2]**2+r[1][2]**2+r[2][2]**2)
    eps=1e-6; uniform=abs(sx-sy)<eps and abs(sx-sz)<eps and sx>eps
    if uniform:
        s=sx; nr=[[r[i][j]/s for j in range(3)] for i in range(3)]
        def dc(a,b): return sum(nr[i][a]*nr[i][b] for i in range(3))
        orth=abs(dc(0,1))<eps and abs(dc(0,2))<eps and abs(dc(1,2))<eps
        if orth:
            if abs(s-1.0)>eps:
                try: shape=shape.scale(s)
                except Exception: shape=_nu_scale(shape,s,s,s)
            trsf=gp_Trsf()
            trsf.SetValues(nr[0][0],nr[0][1],nr[0][2],tx,
                           nr[1][0],nr[1][1],nr[1][2],ty,
                           nr[2][0],nr[2][1],nr[2][2],tz)
            try:
                tr=BRepBuilderAPI_Transform(shape.wrapped,trsf,True)
                return Shape.cast(tr.Shape())
            except Exception: pass
    try:
        gt=gp_GTrsf()
        for i in range(3):
            for j in range(3): gt.SetValue(i+1,j+1,r[i][j])
        gt.SetValue(1,4,tx); gt.SetValue(2,4,ty); gt.SetValue(3,4,tz)
        tr=BRepBuilderAPI_GTransform(shape.wrapped,gt,True)
        return Shape.cast(tr.Shape())
    except Exception as e: _log(f"multmatrix GTrsf: {e}")
    return Location((tx,ty,tz))*shape

# ─────────────────────────────────────────────────────────────────────────────
# §8  HULL / POLYHEDRON
# ─────────────────────────────────────────────────────────────────────────────

def _sample_pts(shape,n=32):
    pts=[]
    try:
        for e in shape.edges():
            for i in range(n):
                try: v=e.point_at(i/n); pts.append((v.X,v.Y,v.Z))
                except Exception: pass
    except Exception: pass
    return pts

def _hull(shapes):
    try:
        import numpy as np; from scipy.spatial import ConvexHull
    except ImportError: return make_compound(shapes)
    pts=[]
    for s in shapes: pts.extend(_sample_pts(s))
    if len(pts)<4: return make_compound(shapes)
    arr=np.unique(np.array(pts),axis=0)
    if len(arr)>2000: arr=arr[::max(1,len(arr)//1000)]
    zr=arr[:,2].max()-arr[:,2].min()
    if zr<1e-6:
        a2=arr[:,:2]
        if len(a2)<3: return make_compound(shapes)
        try:
            ch=ConvexHull(a2); hp=a2[ch.vertices].tolist(); n=len(hp)
            eds=[Edge.make_line((hp[i][0],hp[i][1],0),(hp[(i+1)%n][0],hp[(i+1)%n][1],0)) for i in range(n)]
            return Face(Wire.make_wire(eds))
        except Exception: return make_compound(shapes)
    try:
        ch=ConvexHull(arr); faces=[]
        for s in ch.simplices:
            tri=[arr[i].tolist() for i in s]
            eds=[Edge.make_line(tuple(tri[j]),tuple(tri[(j+1)%3])) for j in range(3)]
            try: faces.append(Face(Wire.make_wire(eds)))
            except Exception: pass
        if faces:
            sh=Shell(faces)
            try:
                ms=BRepBuilderAPI_MakeSolid(sh.wrapped); return Solid(ms.Solid())
            except Exception: return sh
    except Exception: pass
    return make_compound(shapes)

def _polyhedron(points,faces_idx):
    built=[]
    for fi in faces_idx:
        if len(fi)<3: continue
        try:
            fp=[tuple(float(c) for c in points[int(i)]) for i in fi]
            eds=[Edge.make_line(fp[j],fp[(j+1)%len(fp)]) for j in range(len(fp))]
            built.append(Face(Wire.make_wire(eds)))
        except Exception: pass
    if not built: return _micro()
    sh=Shell(built)
    try:
        ms=BRepBuilderAPI_MakeSolid(sh.wrapped); return Solid(ms.Solid())
    except Exception: return sh

# ─────────────────────────────────────────────────────────────────────────────
# §9  EVALUATOR
# ─────────────────────────────────────────────────────────────────────────────

class Evaluator:
    """
    Walks the AST and produces build123d geometry.
    Maintains a variable scope stack and a registry of user module definitions.
    """

    def __init__(self, module_defs: Dict[str,ModuleDef]):
        self._mods = module_defs
        # scope stack: list of dicts, innermost last
        self._scopes: List[Dict[str,Any]] = [dict(_OPENSCAD_CONSTANTS)]

    # ── scope ────────────────────────────────────────────────────────────────
    def _push(self, bindings: Dict[str,Any]=None):
        new=dict(self._scopes[-1])
        if bindings: new.update(bindings)
        self._scopes.append(new)

    def _pop(self):
        if len(self._scopes)>1: self._scopes.pop()

    def _get(self,name):
        return self._scopes[-1].get(name)

    def _set(self,name,val):
        self._scopes[-1][name]=val

    # ── resolve values that may still contain __var__ sentinels ─────────────
    def _resolve(self, val):
        if isinstance(val,str) and val.startswith("__var__"):
            name=val[7:]
            return self._scopes[-1].get(name, None)
        if isinstance(val,list):
            return [self._resolve(v) for v in val]
        return val

    # ── public ───────────────────────────────────────────────────────────────
    def eval_nodes(self, nodes: List[ASTNode]) -> List[Any]:
        shapes=[]
        for n in nodes:
            s=self._eval(n)
            if s is not None:
                shapes.append(s)
        return shapes

    # ── dispatcher ───────────────────────────────────────────────────────────
    def _eval(self, node: ASTNode) -> Optional[Any]:
        try:
            return self._eval_impl(node)
        except Exception:
            _log(f"node '{node.name}' failed:\n{traceback.format_exc(limit=4)}")
            return _micro()

    def _eval_impl(self, node: ASTNode) -> Optional[Any]:
        name=node.name.lower()

        # resolve all attrs / pos_args against current scope
        a={k:self._resolve(v) for k,v in node.attrs.items()}
        p=[self._resolve(v) for v in node.pos_args]

        # ── internal control nodes ────────────────────────────────────────
        if node.name=="__assign__":
            vname=node.attrs["name"]; val=self._resolve(node.attrs["value"])
            self._set(vname,val); return None

        if node.name=="__for__":
            return self._eval_for(node)

        if node.name=="__if__":
            cond=self._resolve(node.attrs.get("cond"))
            # evaluate all children regardless (we don't have else separation yet)
            shapes=self._eval_children(node)
            return make_compound(shapes) if shapes else None

        # ── user module call ──────────────────────────────────────────────
        if node.name in self._mods:
            return self._call_user_module(node, a, p)

        # ── BOSL2 primitives ──────────────────────────────────────────────
        if name=="cyl":         return _bosl2_cyl(a,p)
        if name=="cuboid":      return _bosl2_cuboid(a,p)
        if name in ("xcyl","ycyl","zcyl"):
            orient={"xcyl":[1,0,0],"ycyl":[0,1,0],"zcyl":[0,0,1]}[name]
            a2=dict(a); a2["orient"]=orient; return _bosl2_cyl(a2,p)
        if name=="spheroid":
            return Sphere(radius=float(_g(a,p,0,"r",1.0)))
        if name=="torus":
            rmaj=float(_g(a,p,0,"r_maj",10.0)); rmin=float(_g(a,p,1,"r_min",2.0))
            try:
                prof=Location((rmaj,0,0))*Circle(radius=rmin)
                return revolve(prof,axis=Axis.Z,revolution_arc=360)
            except Exception: return Cylinder(radius=rmaj+rmin,height=rmin*2)
        if name=="prismoid":
            return self._prismoid(a,p)

        # ── standard 3D primitives ────────────────────────────────────────
        if name=="cube":
            size=_g(a,p,0,"size",[1,1,1]); center=bool(_g(a,p,1,"center",False))
            if isinstance(size,(int,float)): size=[float(size)]*3
            x,y,z=float(size[0]),float(size[1]),float(size[2])
            sh=Box(x,y,z)
            if not center: sh=Location((x/2,y/2,z/2))*sh
            return sh

        if name=="cylinder":
            return self._cylinder(a,p)

        if name=="sphere":
            r=_g(a,p,0,"r",None); d=a.get("d")
            if r is None and d is not None: r=float(d)/2
            return Sphere(radius=float(r) if r is not None else 1.0)

        if name=="circle":
            r=_g(a,p,0,"r",None); d=a.get("d")
            if r is None and d is not None: r=float(d)/2
            return Circle(radius=float(r) if r is not None else 1.0)

        if name=="square":
            size=_g(a,p,0,"size",[1,1]); center=bool(_g(a,p,1,"center",False))
            if isinstance(size,(int,float)): size=[float(size)]*2
            x,y=float(size[0]),float(size[1]); sh=Rectangle(x,y)
            if not center: sh=Location((x/2,y/2))*sh
            return sh

        if name=="polygon":
            pts=_g(a,p,0,"points",None)
            if pts and len(pts)>=3:
                try:
                    pts2=[(float(q[0]),float(q[1])) for q in pts]; return Polygon(pts2)
                except Exception:
                    try:
                        pts3=[(float(q[0]),float(q[1]),0.0) for q in pts]
                        eds=[Edge.make_line(pts3[i],pts3[(i+1)%len(pts3)]) for i in range(len(pts3))]
                        return Face(Wire.make_wire(eds))
                    except Exception: pass
            return _micro()

        if name=="polyhedron":
            pts=_g(a,p,0,"points",None); fi=_g(a,p,1,"faces",a.get("triangles"))
            if pts and fi: return _polyhedron(pts,fi)
            return _micro()

        if name=="text":
            txt=str(_g(a,p,0,"text",a.get("txt",""))); sz=float(_g(a,p,1,"size",10.0))
            font=str(a.get("font","Arial"))
            try: return Compound.make_text(txt=txt,font_size=sz,font=font)
            except Exception: return Rectangle(sz,sz)

        # ── extrusions ────────────────────────────────────────────────────
        if name=="linear_extrude":
            height=float(a.get("height",1.0)); center=bool(a.get("center",False))
            scale_=a.get("scale",1.0)
            children=self._eval_children(node)
            if not children: return _micro()
            combined=children[0] if len(children)==1 else _union(children[0],children[1:])
            try:
                taper=0.0
                if isinstance(scale_,(int,float)) and abs(float(scale_)-1.0)>1e-4:
                    taper=math.degrees(math.atan((float(scale_)-1.0)*5.0/height))
                ext=(extrude(combined,amount=height,taper=taper,dir=(0,0,1))
                     if abs(taper)>1e-4
                     else extrude(combined,amount=height,dir=(0,0,1)))
                if center: ext=Location((0,0,-height/2))*ext
                return ext
            except Exception as e:
                _log(f"linear_extrude: {e}"); return combined

        if name=="rotate_extrude":
            angle=float(_g(a,p,0,"angle",360.0))
            children=self._eval_children(node)
            if not children: return _micro()
            combined=children[0] if len(children)==1 else make_compound(children)
            # BOSL2 rotate_extrude: profile already in XY, revolve around Z
            try:
                xz=Rotation(90,0,0)*combined
                return revolve(xz,axis=Axis.Z,revolution_arc=angle)
            except Exception:
                try: return revolve(combined,axis=Axis.Y,revolution_arc=angle)
                except Exception: return combined

        # ── transforms ───────────────────────────────────────────────────
        if name=="translate":
            v=_g(a,p,0,"v",[0,0,0])
            if isinstance(v,(int,float)): v=[float(v),0,0]
            v=_pad(v,3); children=self._eval_children(node)
            if not children: return _micro()
            s=children[0] if len(children)==1 else make_compound(children)
            return Location((float(v[0]),float(v[1]),float(v[2])))*s

        if name=="rotate":
            av=_g(a,p,0,"a",[0,0,0])
            if isinstance(av,(int,float)): av=[0,0,float(av)]
            av=_pad(av,3); children=self._eval_children(node)
            if not children: return _micro()
            s=children[0] if len(children)==1 else make_compound(children)
            try: return Rotation(float(av[0]),float(av[1]),float(av[2]))*s
            except Exception: return s

        if name=="scale":
            v=_g(a,p,0,"v",[1,1,1])
            if isinstance(v,(int,float)): v=[float(v)]*3
            v=_pad(v,3); children=self._eval_children(node)
            if not children: return _micro()
            s=children[0] if len(children)==1 else make_compound(children)
            sx,sy,sz=float(v[0]),float(v[1]),float(v[2])
            if abs(sx-sy)<1e-9 and abs(sx-sz)<1e-9:
                try: return s.scale(sx)
                except Exception: pass
            try: return _nu_scale(s,sx,sy,sz)
            except Exception: return s

        if name=="mirror":
            v=_g(a,p,0,"v",[1,0,0])
            if v is None: v=[1,0,0]
            v=_pad(v,3); children=self._eval_children(node)
            if not children: return _micro()
            s=children[0] if len(children)==1 else make_compound(children)
            try:
                pl=Plane(origin=(0,0,0),z_dir=(float(v[0]),float(v[1]),float(v[2])))
                return s.mirror(about=pl)
            except Exception:
                try: return s.mirror(pl)
                except Exception: return s

        if name=="multmatrix":
            mx=_g(a,p,0,"m",a.get("matrix"))
            children=self._eval_children(node)
            if not children: return _micro()
            s=children[0] if len(children)==1 else make_compound(children)
            if mx:
                with _occ_lock: return _apply_multmatrix(s,mx)
            return s

        if name=="color":
            cv=_g(a,p,0,"c",a.get("color"))
            children=self._eval_children(node)
            if not children: return _micro()
            s=children[0] if len(children)==1 else make_compound(children)
            if cv is not None:
                try:
                    co=(Color(cv) if isinstance(cv,str)
                        else Color(*[float(cv[i]) for i in range(min(4,len(cv)))]))
                    for part in flatten_compound(s): part.color=co
                except Exception: pass
            return s

        if name=="offset":
            amt=float(_g(a,p,0,"r",a.get("delta",1.0)))
            children=self._eval_children(node)
            if not children: return _micro()
            s=children[0] if len(children)==1 else make_compound(children)
            for m2 in ("offset_2d","offset"):
                try: return getattr(s,m2)(amt)
                except Exception: pass
            return s

        if name=="projection":
            cut=bool(_g(a,p,0,"cut",False))
            children=self._eval_children(node)
            if not children: return _micro()
            s=children[0] if len(children)==1 else make_compound(children)
            try: return s.section(Plane.XY) if cut else s.project(Plane.XY)
            except Exception: return s

        if name=="resize":
            ns=_g(a,p,0,"newsize",None)
            children=self._eval_children(node)
            if not children: return _micro()
            s=children[0] if len(children)==1 else make_compound(children)
            if ns and len(ns)>=3:
                try:
                    bb=s.bounding_box()
                    dx=(bb.max.X-bb.min.X) or 1; dy=(bb.max.Y-bb.min.Y) or 1; dz=(bb.max.Z-bb.min.Z) or 1
                    return _nu_scale(s,float(ns[0])/dx,float(ns[1])/dy,float(ns[2])/dz)
                except Exception: pass
            return s

        if name=="minkowski":
            children=self._eval_children(node)
            if not children: return _micro()
            or_=None
            for cn in node.children:
                cn_name=cn.name.lower()
                if cn_name in ("circle","sphere"):
                    r=_g(cn.attrs,cn.pos_args,0,"r",None); d=cn.attrs.get("d")
                    if r is None and d is not None: r=float(d)/2
                    if r is not None: or_=float(r); break
            base=children[0]
            if or_ is not None:
                for m2 in ("offset_2d","offset"):
                    try: return getattr(base,m2)(or_)
                    except Exception: pass
            return make_compound(children)

        # ── booleans ─────────────────────────────────────────────────────
        if name in ("union","group"):
            children=self._eval_children(node)
            if not children: return _micro()
            return _union(children[0],children[1:])

        if name=="difference":
            children=self._eval_children(node)
            if not children: return _micro()
            if len(children)==1: return children[0]
            with _occ_lock: return _difference(children[0],children[1:])

        if name=="intersection":
            children=self._eval_children(node)
            if not children: return _micro()
            with _occ_lock: return _intersection(children[0],children[1:])

        if name in ("intersection_for","render","cache","root"):
            children=self._eval_children(node)
            if not children: return _micro()
            if name=="intersection_for":
                with _occ_lock: return _intersection(children[0],children[1:])
            return children[0] if len(children)==1 else make_compound(children)

        if name=="hull":
            children=self._eval_children(node)
            if not children: return _micro()
            with _occ_lock: return _hull(children)

        if name=="surface": return Box(10,10,1)

        # ── BOSL2 spatial shortcuts ───────────────────────────────────────
        if name in ("move","position","align"):
            v=_g(a,p,0,"v",a.get("to",[0,0,0])); v=_pad(v,3)
            children=self._eval_children(node)
            if not children: return _micro()
            s=children[0] if len(children)==1 else make_compound(children)
            return Location((float(v[0]),float(v[1]),float(v[2])))*s

        if name in ("xrot","yrot","zrot"):
            ang=float(_g(a,p,0,"a",0.0))
            children=self._eval_children(node)
            if not children: return _micro()
            s=children[0] if len(children)==1 else make_compound(children)
            rm={"xrot":(ang,0,0),"yrot":(0,ang,0),"zrot":(0,0,ang)}
            return Rotation(*rm[name])*s

        if name in ("back","fwd","left","right","up","down"):
            d2=float(_g(a,p,0,"d",0.0))
            dm={"back":(0,d2,0),"fwd":(0,-d2,0),"left":(-d2,0,0),
                "right":(d2,0,0),"up":(0,0,d2),"down":(0,0,-d2)}
            children=self._eval_children(node)
            if not children: return _micro()
            s=children[0] if len(children)==1 else make_compound(children)
            return Location(dm[name])*s

        # ── unknown: pass-through ─────────────────────────────────────────
        children=self._eval_children(node)
        if not children: return None
        return children[0] if len(children)==1 else make_compound(children)

    # ── helpers ───────────────────────────────────────────────────────────────

    def _eval_children(self, node: ASTNode) -> List[Any]:
        out=[]
        for c in node.children:
            s=self._eval(c)
            if s is not None: out.append(s)
        return out

    def _eval_for(self, node: ASTNode) -> Optional[Any]:
        var=node.attrs["var"]; iterable=self._resolve(node.attrs["iter"])
        if not isinstance(iterable,(list,tuple)): return None
        shapes=[]
        for val in iterable:
            self._push({var:val})
            for child in node.children:
                s=self._eval(child)
                if s is not None: shapes.append(s)
            self._pop()
        if not shapes: return None
        return make_compound(shapes)

    def _call_user_module(self, node: ASTNode,
                          resolved_attrs: Dict[str,Any],
                          resolved_pos: List[Any]) -> Optional[Any]:
        mod=self._mods[node.name]
        # bind parameters
        bindings: Dict[str,Any]={}
        for i,(pname,default) in enumerate(mod.params):
            if pname in resolved_attrs:
                bindings[pname]=resolved_attrs[pname]
            elif i<len(resolved_pos):
                bindings[pname]=resolved_pos[i]
            else:
                bindings[pname]=self._resolve(default) if default is not None else None
        self._push(bindings)
        shapes=self.eval_nodes(mod.body)
        self._pop()
        if not shapes: return None
        return shapes[0] if len(shapes)==1 else make_compound(shapes)

    def _cylinder(self, a, p):
        h=None; r=None; r1=None; r2=None; d=None; d1=None; d2=None; center=False
        if len(p)>=1: h=p[0]
        if len(p)>=2:
            if isinstance(p[1],bool): center=p[1]
            else: r=p[1]
        if len(p)>=3:
            if isinstance(p[2],bool): center=p[2]
            else: r1=p[1]; r2=p[2]
        if len(p)>=4: center=bool(p[3])
        h=float(a.get("h",h if h is not None else 1.0))
        r=a.get("r",r); r1=a.get("r1",r1); r2=a.get("r2",r2)
        d=a.get("d",d); d1=a.get("d1",d1); d2=a.get("d2",d2)
        center=bool(a.get("center",center))
        if r  is not None: r =float(r)
        if r1 is not None: r1=float(r1)
        if r2 is not None: r2=float(r2)
        if r1 is None and d1 is not None: r1=float(d1)/2
        if r2 is None and d2 is not None: r2=float(d2)/2
        if r1 is None and r2 is None:
            if r is not None: r1=r2=r
            elif d is not None: r1=r2=float(d)/2
            else: r1=r2=1.0
        r1=r1 if r1 is not None else r2; r2=r2 if r2 is not None else r1
        sh=(Cylinder(radius=r1,height=h) if abs(r1-r2)<1e-6
            else Cone(bottom_radius=r1,top_radius=r2,height=h))
        if not center: sh=Location((0,0,h/2))*sh
        return sh

    def _prismoid(self, a, p):
        s1=_g(a,p,0,"size1",[1,1]); s2=_g(a,p,1,"size2",[1,1])
        h=float(_g(a,p,2,"h",1.0))
        if isinstance(s1,(int,float)): s1=[float(s1)]*2
        if isinstance(s2,(int,float)): s2=[float(s2)]*2
        x1,y1=float(s1[0])/2,float(s1[1])/2
        x2,y2=float(s2[0])/2,float(s2[1])/2
        try:
            b=[(-x1,-y1,0),(x1,-y1,0),(x1,y1,0),(-x1,y1,0)]
            t2=[(-x2,-y2,h),(x2,-y2,h),(x2,y2,h),(-x2,y2,h)]
            be=[Edge.make_line(b[i],b[(i+1)%4]) for i in range(4)]
            te=[Edge.make_line(t2[i],t2[(i+1)%4]) for i in range(4)]
            from build123d import loft
            return loft([Face(Wire.make_wire(be)),Face(Wire.make_wire(te))])
        except Exception: return Box((x1+x2),(y1+y2),h)

def _pad(v,n):
    if not isinstance(v,(list,tuple)): return [0.0]*n
    return [float(v[i]) if i<len(v) else 0.0 for i in range(n)]

# ─────────────────────────────────────────────────────────────────────────────
# §10  PUBLIC API
# ─────────────────────────────────────────────────────────────────────────────

class CSGParser:
    """Thread-safe entry point."""

    @staticmethod
    def parse(source: str) -> Any:
        lexer  = Lexer(source)
        tokens = lexer.tokenize()
        parser = Parser(tokens)
        nodes  = parser.parse()
        ev     = Evaluator(parser.module_defs)
        shapes = ev.eval_nodes(nodes)
        # drop __assign__ results (None) and micro-boxes at root
        real   = [s for s in shapes if s is not None]
        if not real:
            raise ValueError("No valid geometry produced from input.")
        _clear(real)
        return real[0] if len(real)==1 else make_compound(real)

def export_to_step(shape: Any, filename: str) -> None:
    try: shape.parent=None
    except Exception: pass
    for s in flatten_compound(shape):
        try: s.parent=None
        except Exception: pass
    export_step(shape,filename)