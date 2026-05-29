import re
from typing import Any, List, Dict, Tuple
from pathlib import Path
from build123d import Box, Cylinder, Location, Compound, Rotation


class ASTNode:
    def __init__(self, name: str, attrs: Dict[str, Any] = None, children: List['ASTNode'] = None, pos_args: List[Any] = None):
        self.name = name
        self.attrs = attrs or {}
        self.children = children or []
        self.pos_args = pos_args or []


def strip_comments(text: str) -> str:
    # Remove single line comments
    text = re.sub(r'//.*', '', text)
    # Remove multi-line comments
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)
    return text


def tokenize(text: str) -> List[Tuple[str, str]]:
    text = strip_comments(text)
    token_re = re.compile(
        r'\s*(?:'
        r'(?P<number>-?\d+(?:\.\d+)?)'
        r'|(?P<boolean>true|false)'
        r'|(?P<ident>\$?[a-zA-Z_][a-zA-Z0-9_]*)'
        r'|(?P<sym>[(){}[\]=,;])'
        r')'
    )
    tokens = []
    pos = 0
    while pos < len(text):
        match = token_re.match(text, pos)
        if not match:
            if text[pos].isspace():
                pos += 1
                continue
            raise ValueError(f"Unexpected character in CSG string at position {pos}: {text[pos:pos+10]!r}")
        
        group = match.lastgroup
        value = match.group(group)
        tokens.append((value, group))
        pos = match.end()
    return tokens


def parse_value(tokens: List[Tuple[str, str]], index: int) -> Tuple[Any, int]:
    if index >= len(tokens):
        raise ValueError("Unexpected end of tokens while parsing value")
        
    token_val, token_type = tokens[index]
    
    if token_type == 'number':
        val = float(token_val) if '.' in token_val else int(token_val)
        return val, index + 1
        
    elif token_type == 'boolean':
        val = token_val == 'true'
        return val, index + 1
        
    elif token_val == '[':
        index += 1
        arr = []
        while index < len(tokens) and tokens[index][0] != ']':
            item_val, item_index = parse_value(tokens, index)
            arr.append(item_val)
            index = item_index
            if index < len(tokens) and tokens[index][0] == ',':
                index += 1
        if index >= len(tokens) or tokens[index][0] != ']':
            raise ValueError(f"Expected ']' at token {index}")
        return arr, index + 1
        
    elif token_type == 'ident':
        return token_val, index + 1
        
    else:
        raise ValueError(f"Unexpected token type {token_type} for value: {token_val}")


def parse_statement(tokens: List[Tuple[str, str]], index: int) -> Tuple[ASTNode, int]:
    if index >= len(tokens):
        raise ValueError("Unexpected end of tokens while parsing statement")
        
    token_val, token_type = tokens[index]
    if token_type != 'ident':
        raise ValueError(f"Expected identifier at token {index}: {token_val}")
    
    name = token_val
    index += 1
    
    if index >= len(tokens) or tokens[index][0] != '(':
        raise ValueError(f"Expected '(' after {name} at token {index}")
    index += 1
    
    attrs = {}
    pos_args = []
    while index < len(tokens) and tokens[index][0] != ')':
        is_named = (
            index + 1 < len(tokens)
            and tokens[index][1] == 'ident'
            and tokens[index + 1][0] == '='
        )
        
        if is_named:
            attr_name_val = tokens[index][0]
            index += 2
            val, index = parse_value(tokens, index)
            attrs[attr_name_val] = val
        else:
            val, index = parse_value(tokens, index)
            pos_args.append(val)
        
        if index < len(tokens) and tokens[index][0] == ',':
            index += 1
            
    if index >= len(tokens) or tokens[index][0] != ')':
        raise ValueError(f"Expected ')' at token {index}")
    index += 1
    
    # Primitive statement ends with ';'
    if index < len(tokens) and tokens[index][0] == ';':
        index += 1
        return ASTNode(name, attrs=attrs, pos_args=pos_args), index
        
    # Block statement starts with '{'
    elif index < len(tokens) and tokens[index][0] == '{':
        index += 1
        children, index = parse_statements(tokens, index)
        if index >= len(tokens) or tokens[index][0] != '}':
            raise ValueError(f"Expected '}}' at token {index}")
        index += 1
        return ASTNode(name, attrs=attrs, children=children, pos_args=pos_args), index
        
    else:
        raise ValueError(f"Expected ';' or '{{' at token {index}: {tokens[index][0] if index < len(tokens) else 'EOF'}")


def parse_statements(tokens: List[Tuple[str, str]], index: int) -> Tuple[List[ASTNode], int]:
    statements = []
    while index < len(tokens):
        if tokens[index][0] == '}':
            break
        node, index = parse_statement(tokens, index)
        statements.append(node)
    return statements, index


def evaluate_node(node: ASTNode) -> Any:
    try:
        return _evaluate_node_impl(node)
    except Exception as e:
        print(f"Failed parsing node: {node.name}")
        print(f"Error details: {e}")
        return None


def _evaluate_node_impl(node: ASTNode) -> Any:
    name = node.name.lower()
    
    # Filter out dollar-sign prefixed special variables (e.g., $fn, $fa, $fs)
    # to avoid passing them to primitive builders which would cause type/signature errors.
    node.attrs = {k: v for k, v in node.attrs.items() if not k.startswith('$')}
    
    # ── Primitives ──
    if name == 'cube':
        size = node.attrs.get('size', [1.0, 1.0, 1.0])
        if isinstance(size, (int, float)):
            size = [float(size)] * 3
        x, y, z = size
        center = node.attrs.get('center', False)
        
        shape = Box(x, y, z)
        if not center:
            shape = Location((x / 2.0, y / 2.0, z / 2.0)) * shape
        return shape
        
    elif name == 'cylinder':
        h = node.attrs.get('h', 1.0)
        center = node.attrs.get('center', False)
        
        # Resolve radius
        r1 = None
        r2 = None
        if 'r1' in node.attrs:
            r1 = node.attrs['r1']
        elif 'd1' in node.attrs:
            r1 = node.attrs['d1'] / 2.0
            
        if 'r2' in node.attrs:
            r2 = node.attrs['r2']
        elif 'd2' in node.attrs:
            r2 = node.attrs['d2'] / 2.0
            
        if r1 is None and r2 is None:
            if 'r' in node.attrs:
                r1 = r2 = node.attrs['r']
            elif 'd' in node.attrs:
                r1 = r2 = node.attrs['d'] / 2.0
            else:
                r1 = r2 = 1.0
                
        if r1 is not None and r2 is None:
            r2 = r1
        if r2 is not None and r1 is None:
            r1 = r2

        if r1 == r2:
            shape = Cylinder(radius=r1, height=h)
        else:
            shape = Cylinder(radius1=r1, radius2=r2, height=h)
            
        if not center:
            shape = Location((0, 0, h / 2.0)) * shape
        return shape
        
    # ── Transforms ──
    elif name == 'translate':
        v = node.attrs.get('v', [0.0, 0.0, 0.0])
        loc = Location((v[0], v[1], v[2]))
        
        child_shapes = [evaluate_node(c) for c in node.children]
        child_shapes = [s for s in child_shapes if s is not None]
        if not child_shapes:
            return None
        
        if len(child_shapes) == 1:
            combined = child_shapes[0]
        else:
            combined = Compound(children=child_shapes)
            
        return loc * combined
        
    elif name == 'rotate':
        a = node.attrs.get('a', [0.0, 0.0, 0.0])
        try:
            loc = Rotation(a[0], a[1], a[2])
        except Exception:
            try:
                loc = Location((0, 0, 0), (a[0], a[1], a[2]))
            except Exception:
                loc = Location((0, 0, 0))
        
        child_shapes = [evaluate_node(c) for c in node.children]
        child_shapes = [s for s in child_shapes if s is not None]
        if not child_shapes:
            return None
            
        if len(child_shapes) == 1:
            combined = child_shapes[0]
        else:
            combined = Compound(children=child_shapes)
            
        return loc * combined
        
    elif name == 'multmatrix':
        matrix = None
        if node.pos_args:
            matrix = node.pos_args[0]
        elif 'm' in node.attrs:
            matrix = node.attrs['m']
        elif 'matrix' in node.attrs:
            matrix = node.attrs['matrix']
            
        if matrix and len(matrix) >= 3 and all(len(row) >= 4 for row in matrix[:3]):
            try:
                from OCP.gp import gp_Trsf
                trsf = gp_Trsf()
                trsf.SetValues(
                    float(matrix[0][0]), float(matrix[0][1]), float(matrix[0][2]), float(matrix[0][3]),
                    float(matrix[1][0]), float(matrix[1][1]), float(matrix[1][2]), float(matrix[1][3]),
                    float(matrix[2][0]), float(matrix[2][1]), float(matrix[2][2]), float(matrix[2][3])
                )
                loc = Location(trsf)
            except Exception:
                loc = Location((0, 0, 0))
        else:
            loc = Location((0, 0, 0))
            
        child_shapes = [evaluate_node(c) for c in node.children]
        child_shapes = [s for s in child_shapes if s is not None]
        if not child_shapes:
            return None
            
        if len(child_shapes) == 1:
            combined = child_shapes[0]
        else:
            combined = Compound(children=child_shapes)
            
        return loc * combined
        
    # ── Boolean Operators ──
    elif name == 'union':
        child_shapes = [evaluate_node(c) for c in node.children]
        child_shapes = [s for s in child_shapes if s is not None]
        if not child_shapes:
            return None
            
        combined = child_shapes[0]
        for s in child_shapes[1:]:
            combined = combined + s
        return combined
        
    elif name == 'group':
        child_shapes = [evaluate_node(c) for c in node.children]
        child_shapes = [s for s in child_shapes if s is not None]
        if not child_shapes:
            return None
            
        if len(child_shapes) == 1:
            combined = child_shapes[0]
        else:
            combined = Compound(children=child_shapes)
        return combined
        
    elif name == 'difference':
        child_shapes = [evaluate_node(c) for c in node.children]
        child_shapes = [s for s in child_shapes if s is not None]
        if not child_shapes:
            return None
            
        combined = child_shapes[0]
        for s in child_shapes[1:]:
            combined = combined - s
        return combined
        
    elif name == 'intersection':
        child_shapes = [evaluate_node(c) for c in node.children]
        child_shapes = [s for s in child_shapes if s is not None]
        if not child_shapes:
            return None
            
        combined = child_shapes[0]
        for s in child_shapes[1:]:
            combined = combined & s
        return combined
        
    else:
        # Unknown/Ignore node - return combined children
        child_shapes = [evaluate_node(c) for c in node.children]
        child_shapes = [s for s in child_shapes if s is not None]
        if not child_shapes:
            return None
        if len(child_shapes) == 1:
            combined = child_shapes[0]
        else:
            combined = Compound(children=child_shapes)
        return combined


class CSGParser:
    @staticmethod
    def parse(csg_string: str) -> Compound:
        tokens = tokenize(csg_string)
        nodes, _ = parse_statements(tokens, 0)
        shapes = [evaluate_node(n) for n in nodes]
        shapes = [s for s in shapes if s is not None]
        
        if not shapes:
            raise ValueError("No valid geometry could be evaluated from the CSG tree.")
            
        if len(shapes) == 1:
            return Compound(children=[shapes[0]])
        else:
            return Compound(children=shapes)


def export_to_step(shape: Any, path: str) -> None:
    try:
        from build123d import export_step
        export_step(shape, path)
        return
    except Exception:
        pass

    try:
        shape.export_step(path)
        return
    except Exception:
        pass

    try:
        from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs
        writer = STEPControl_Writer()
        writer.Transfer(shape.wrapped, STEPControl_AsIs)
        writer.Write(path)
        return
    except Exception as e:
        raise RuntimeError(f"Failed to export shape to STEP: {e}")
