import { Vector3, Line3, Matrix4, Euler, Quaternion } from 'three';

export type OpenScadParameters = Record<string, unknown>;

export type AnnotationEntry = {
	type?: 'diameter' | 'height' | 'chamfer';
	p1?: [number, number, number];
	p2?: [number, number, number];
	center?: [number, number, number];
	axis?: [number, number, number];
	value?: number;
	offset?: number;
	radius?: number;
};

export type OpenScadAnnotations = Record<string, AnnotationEntry>;

/**
 * Parses the /* PARAMETERS_JSON ... * / block from the OpenSCAD script
 * to extract the 3D coordinate annotations.
 */
export function extractStructuredAnnotations(script: string): OpenScadAnnotations {
	const match = /\/\*\s*PARAMETERS_JSON\s*([\s\S]*?)\*\//.exec(script);
	let explicitAnnotations: OpenScadAnnotations = {};
	if (match) {
		try {
			const jsonText = match[1].trim();
			explicitAnnotations = JSON.parse(jsonText) as OpenScadAnnotations;
		} catch (e) {
			console.error("Failed to parse PARAMETERS_JSON from script:", e);
		}
	}

	try {
		const params = extractOpenScadParameters(script);
		const numParams: Record<string, number> = {};
		for (const [k, v] of Object.entries(params)) {
			if (typeof v === 'number') {
				numParams[k] = v;
			}
		}
		const inferred = inferAnnotations(script, numParams);
		const merged: OpenScadAnnotations = { ...inferred };
		for (const [key, entry] of Object.entries(explicitAnnotations)) {
			merged[key] = {
				...merged[key],
				...entry,
			};
			if (params[key] !== undefined && typeof params[key] === 'number') {
				merged[key].value = params[key] as number;
			}
		}
		return merged;
	} catch (e) {
		console.error("Failed to infer annotations:", e);
		return explicitAnnotations;
	}
}

function stripComments(script: string): string {
	let result = '';
	let i = 0;
	while (i < script.length) {
		if (script[i] === '"') {
			result += script[i];
			i++;
			while (i < script.length && script[i] !== '"') {
				if (script[i] === '\\') {
					result += script[i];
					i++;
				}
				result += script[i];
				i++;
			}
			if (i < script.length) {
				result += script[i];
				i++;
			}
		} else if (script[i] === '/' && script[i + 1] === '/') {
			i += 2;
			while (i < script.length && script[i] !== '\n') {
				i++;
			}
		} else if (script[i] === '/' && script[i + 1] === '*') {
			i += 2;
			while (i < script.length && !(script[i] === '*' && script[i + 1] === '/')) {
				i++;
			}
			i += 2;
		} else {
			result += script[i];
			i++;
		}
	}
	return result;
}

type ModuleDef = {
	name: string;
	body: string;
};

function extractModules(cleanScript: string): ModuleDef[] {
	const modules: ModuleDef[] = [];
	const moduleRegex = /\bmodule\s+(\w+)\s*\(/g;
	let match;
	while ((match = moduleRegex.exec(cleanScript)) !== null) {
		const name = match[1];
		let idx = moduleRegex.lastIndex;
		// Skip parameters by matching parentheses
		let parenCount = 1;
		while (idx < cleanScript.length && parenCount > 0) {
			if (cleanScript[idx] === '(') parenCount++;
			else if (cleanScript[idx] === ')') parenCount--;
			idx++;
		}
		// Find opening brace '{'
		while (idx < cleanScript.length && cleanScript[idx] !== '{') {
			idx++;
		}
		if (idx >= cleanScript.length) continue;
		
		// Match braces to find module body
		const startBodyIdx = idx + 1;
		let braceCount = 1;
		idx++;
		while (idx < cleanScript.length && braceCount > 0) {
			if (cleanScript[idx] === '{') braceCount++;
			else if (cleanScript[idx] === '}') braceCount--;
			idx++;
		}
		const body = cleanScript.substring(startBodyIdx, idx - 1);
		modules.push({ name, body });
	}
	return modules;
}

type Token = 
	| { type: '{' }
	| { type: '}' }
	| { type: ';' }
	| { type: 'translate'; values: [string, string, string] }
	| { type: 'rotate'; values: [string, string, string] }
	| { type: 'cylinder'; params: string }
	| { type: 'cube'; params: string };

function splitParams(str: string): string[] {
	const res: string[] = [];
	let current = '';
	let parenCount = 0;
	let bracketCount = 0;
	for (let j = 0; j < str.length; j++) {
		const c = str[j];
		if (c === '(') parenCount++;
		else if (c === ')') parenCount--;
		else if (c === '[') bracketCount++;
		else if (c === ']') bracketCount--;
		
		if (c === ',' && parenCount === 0 && bracketCount === 0) {
			res.push(current);
			current = '';
		} else {
			current += c;
		}
	}
	if (current) {
		res.push(current);
	}
	return res;
}

function tokenizeBody(body: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;

	while (i < body.length) {
		const char = body[i];
		
		if (/\s/.test(char)) {
			i++;
			continue;
		}
		
		if (char === '{') {
			tokens.push({ type: '{' });
			i++;
			continue;
		}
		if (char === '}') {
			tokens.push({ type: '}' });
			i++;
			continue;
		}
		if (char === ';') {
			tokens.push({ type: ';' });
			i++;
			continue;
		}
		
		// Check for translate
		if (body.startsWith('translate', i)) {
			let idx = i + 'translate'.length;
			while (idx < body.length && /\s/.test(body[idx])) idx++;
			if (body[idx] === '(') {
				let pCount = 1;
				let startP = idx + 1;
				idx++;
				while (idx < body.length && pCount > 0) {
					if (body[idx] === '(') pCount++;
					else if (body[idx] === ')') pCount--;
					idx++;
				}
				const content = body.substring(startP, idx - 1).trim();
				let inner = content;
				if (inner.startsWith('[') && inner.endsWith(']')) {
					inner = inner.substring(1, inner.length - 1);
				}
				const parts = splitParams(inner);
				if (parts.length === 3) {
					tokens.push({ 
						type: 'translate', 
						values: [parts[0].trim(), parts[1].trim(), parts[2].trim()] 
					});
				}
				i = idx;
				continue;
			}
		}
		
		// Check for rotate
		if (body.startsWith('rotate', i)) {
			let idx = i + 'rotate'.length;
			while (idx < body.length && /\s/.test(body[idx])) idx++;
			if (body[idx] === '(') {
				let pCount = 1;
				let startP = idx + 1;
				idx++;
				while (idx < body.length && pCount > 0) {
					if (body[idx] === '(') pCount++;
					else if (body[idx] === ')') pCount--;
					idx++;
				}
				const content = body.substring(startP, idx - 1).trim();
				let inner = content;
				if (inner.startsWith('[') && inner.endsWith(']')) {
					inner = inner.substring(1, inner.length - 1);
				}
				const parts = splitParams(inner);
				if (parts.length === 3) {
					tokens.push({ 
						type: 'rotate', 
						values: [parts[0].trim(), parts[1].trim(), parts[2].trim()] 
					});
				}
				i = idx;
				continue;
			}
		}
		
		// Check for cylinder
		if (body.startsWith('cylinder', i)) {
			let idx = i + 'cylinder'.length;
			while (idx < body.length && /\s/.test(body[idx])) idx++;
			if (body[idx] === '(') {
				let pCount = 1;
				let startP = idx + 1;
				idx++;
				while (idx < body.length && pCount > 0) {
					if (body[idx] === '(') pCount++;
					else if (body[idx] === ')') pCount--;
					idx++;
				}
				const content = body.substring(startP, idx - 1).trim();
				tokens.push({ type: 'cylinder', params: content });
				i = idx;
				continue;
			}
		}
		
		// Check for cube
		if (body.startsWith('cube', i)) {
			let idx = i + 'cube'.length;
			while (idx < body.length && /\s/.test(body[idx])) idx++;
			if (body[idx] === '(') {
				let pCount = 1;
				let startP = idx + 1;
				idx++;
				while (idx < body.length && pCount > 0) {
					if (body[idx] === '(') pCount++;
					else if (body[idx] === ')') pCount--;
					idx++;
				}
				const content = body.substring(startP, idx - 1).trim();
				tokens.push({ type: 'cube', params: content });
				i = idx;
				continue;
			}
		}
		
		i++;
	}
	return tokens;
}

function parseCubeParams(paramsStr: string, evaluate: (expr: string) => number): { 
	xVal: number; 
	yVal: number; 
	zVal: number; 
	xExpr: string; 
	yExpr: string; 
	zExpr: string; 
	isCentered: boolean; 
} {
	let sizeStr = '';
	let centerStr = '';
	
	const parts = splitParams(paramsStr);
	for (const part of parts) {
		const trimmed = part.trim();
		if (trimmed.startsWith('size')) {
			const eqIdx = trimmed.indexOf('=');
			sizeStr = trimmed.substring(eqIdx + 1).trim();
		} else if (trimmed.startsWith('center')) {
			const eqIdx = trimmed.indexOf('=');
			centerStr = trimmed.substring(eqIdx + 1).trim();
		} else {
			if (trimmed.startsWith('[')) {
				sizeStr = trimmed;
			} else if (trimmed === 'true' || trimmed === 'false') {
				centerStr = trimmed;
			} else if (!sizeStr) {
				sizeStr = trimmed;
			}
		}
	}
	
	let xExpr = '0', yExpr = '0', zExpr = '0';
	let isCentered = centerStr === 'true';
	
	if (sizeStr.startsWith('[') && sizeStr.endsWith(']')) {
		const inner = sizeStr.substring(1, sizeStr.length - 1);
		const subParts = splitParams(inner);
		if (subParts.length === 3) {
			xExpr = subParts[0].trim();
			yExpr = subParts[1].trim();
			zExpr = subParts[2].trim();
		}
	} else if (sizeStr) {
		xExpr = sizeStr;
		yExpr = sizeStr;
		zExpr = sizeStr;
	}
	
	return {
		xVal: evaluate(xExpr),
		yVal: evaluate(yExpr),
		zVal: evaluate(zExpr),
		xExpr,
		yExpr,
		zExpr,
		isCentered
	};
}

function parseCylinderParams(paramsStr: string, evaluate: (expr: string) => number): {
	hVal: number;
	hExpr: string;
	dExpr: string;
	rExpr: string;
	isCentered: boolean;
} {
	let hExpr = '0';
	let dExpr = '';
	let rExpr = '';
	let isCentered = false;
	
	const parts = splitParams(paramsStr);
	let positionalIdx = 0;
	for (const part of parts) {
		const trimmed = part.trim();
		if (trimmed.includes('=')) {
			const eqIdx = trimmed.indexOf('=');
			const key = trimmed.substring(0, eqIdx).trim();
			const val = trimmed.substring(eqIdx + 1).trim();
			if (key === 'h') hExpr = val;
			else if (key === 'd' || key === 'd1') dExpr = val;
			else if (key === 'r' || key === 'r1') rExpr = val;
			else if (key === 'center') isCentered = (val === 'true');
		} else {
			if (positionalIdx === 0) {
				hExpr = trimmed;
			} else if (positionalIdx === 1) {
				rExpr = trimmed;
			} else if (positionalIdx === 3) {
				isCentered = (trimmed === 'true');
			}
			positionalIdx++;
		}
	}
	
	return {
		hVal: evaluate(hExpr),
		hExpr,
		dExpr,
		rExpr,
		isCentered
	};
}

export function inferAnnotations(script: string, params: Record<string, number>): OpenScadAnnotations {
	const annotations: OpenScadAnnotations = {};

	function evaluateExpression(expr: string): number {
		let cleaned = expr.replace(/\beps\b/g, '0');
		for (const [key, val] of Object.entries(params)) {
			const re = new RegExp(`\\b${key}\\b`, 'g');
			cleaned = cleaned.replace(re, String(val));
		}
		cleaned = cleaned.replace(/[^0-9.+\-*/() ]/g, '');
		try {
			return Function(`return (${cleaned})`)();
		} catch {
			return 0;
		}
	}

	const cleanScript = stripComments(script);
	const modules = extractModules(cleanScript);

	for (const mod of modules) {
		const tokens = tokenizeBody(mod.body);
		
		let currentTransform = new Matrix4();
		let pendingTransform = new Matrix4();
		const stack: { currentTransform: Matrix4; pendingTransform: Matrix4 }[] = [];

		for (const token of tokens) {
			if (token.type === '{') {
				stack.push({
					currentTransform: currentTransform.clone(),
					pendingTransform: pendingTransform.clone()
				});
				currentTransform.multiply(pendingTransform);
				pendingTransform.identity();
			} else if (token.type === '}') {
				if (stack.length > 0) {
					const popped = stack.pop()!;
					currentTransform.copy(popped.currentTransform);
					pendingTransform.copy(popped.pendingTransform);
				}
			} else if (token.type === ';') {
				pendingTransform.identity();
			} else if (token.type === 'translate') {
				const tx = evaluateExpression(token.values[0]);
				const ty = evaluateExpression(token.values[1]);
				const tz = evaluateExpression(token.values[2]);
				const m = new Matrix4().makeTranslation(tx, ty, tz);
				pendingTransform.multiply(m);
			} else if (token.type === 'rotate') {
				const rx = (evaluateExpression(token.values[0]) * Math.PI) / 180;
				const ry = (evaluateExpression(token.values[1]) * Math.PI) / 180;
				const rz = (evaluateExpression(token.values[2]) * Math.PI) / 180;
				const m = new Matrix4().makeRotationFromEuler(new Euler(rx, ry, rz, 'XYZ'));
				pendingTransform.multiply(m);
			} else if (token.type === 'cylinder') {
				const cyl = parseCylinderParams(token.params, evaluateExpression);
				const totalTransform = currentTransform.clone().multiply(pendingTransform);
				
				const position = new Vector3();
				const quaternion = new Quaternion();
				const scaleVec = new Vector3();
				totalTransform.decompose(position, quaternion, scaleVec);

				const worldAxisVec = new Vector3(0, 0, 1).applyQuaternion(quaternion).normalize();
				const worldAxis: [number, number, number] = [worldAxisVec.x, worldAxisVec.y, worldAxisVec.z];

				const isCentered = cyl.isCentered;
				const hVal = cyl.hVal;

				// Diameter annotation
				if (cyl.dExpr || cyl.rExpr) {
					const paramName = cyl.dExpr || cyl.rExpr;
					if (params[paramName] !== undefined) {
						const localCenter = isCentered ? new Vector3(0, 0, 0) : new Vector3(0, 0, hVal / 2);
						const worldCenterVec = localCenter.clone().applyMatrix4(totalTransform);
						const worldCenter: [number, number, number] = [worldCenterVec.x, worldCenterVec.y, worldCenterVec.z];

						annotations[paramName] = {
							type: 'diameter',
							center: worldCenter,
							axis: worldAxis,
							value: cyl.dExpr ? params[paramName] : (params[paramName] as number) * 2,
						};
					}
				}

				// Height annotation
				if (cyl.hExpr) {
					for (const paramName of Object.keys(params)) {
						const re = new RegExp(`\\b${paramName}\\b`);
						if (re.test(cyl.hExpr)) {
							const localP1 = isCentered ? new Vector3(0, 0, -hVal / 2) : new Vector3(0, 0, 0);
							const localP2 = isCentered ? new Vector3(0, 0, hVal / 2) : new Vector3(0, 0, hVal);

							const worldP1Vec = localP1.clone().applyMatrix4(totalTransform);
							const worldP2Vec = localP2.clone().applyMatrix4(totalTransform);

							annotations[paramName] = {
								type: 'height',
								p1: [worldP1Vec.x, worldP1Vec.y, worldP1Vec.z],
								p2: [worldP2Vec.x, worldP2Vec.y, worldP2Vec.z],
								value: params[paramName] as number,
							};
							break;
						}
					}
				}
				
				pendingTransform.identity();

			} else if (token.type === 'cube') {
				const cube = parseCubeParams(token.params, evaluateExpression);
				const totalTransform = currentTransform.clone().multiply(pendingTransform);

				const expressions = [cube.xExpr, cube.yExpr, cube.zExpr];
				const values = [cube.xVal, cube.yVal, cube.zVal];

				for (let i = 0; i < 3; i++) {
					for (const paramName of Object.keys(params)) {
						const re = new RegExp(`\\b${paramName}\\b`);
						if (re.test(expressions[i])) {
							const lengthVal = values[i];
							
							const localP1 = new Vector3();
							const localP2 = new Vector3();

							if (cube.isCentered) {
								localP1.setComponent(i, -lengthVal / 2);
								localP2.setComponent(i, lengthVal / 2);
							} else {
								localP1.setComponent(i, 0);
								localP2.setComponent(i, lengthVal);
							}

							const worldP1Vec = localP1.clone().applyMatrix4(totalTransform);
							const worldP2Vec = localP2.clone().applyMatrix4(totalTransform);

							annotations[paramName] = {
								type: 'height',
								p1: [worldP1Vec.x, worldP1Vec.y, worldP1Vec.z],
								p2: [worldP2Vec.x, worldP2Vec.y, worldP2Vec.z],
								value: params[paramName] as number,
							};
							break;
						}
					}
				}
				
				pendingTransform.identity();
			}
		}
	}

	return annotations;
}


const START_TAG = '// PARAMETERS_START';
const END_TAG   = '// PARAMETERS_END';

/**
 * Extracts parameters from OpenSCAD script.
 * Prioritises tagged blocks, but falls back to parsing top-level assignments.
 */
export function extractOpenScadParameters(script: string): OpenScadParameters {
	const params: OpenScadParameters = {};

	// 1. Try to find content between TAGS first (highest reliability)
	const taggedRE = new RegExp(`${escapeRE(START_TAG)}[\\s\\S]*?${escapeRE(END_TAG)}`);
	const taggedMatch = taggedRE.exec(script);
	
	const searchContent = taggedMatch ? taggedMatch[0] : script;

	// 2. Parse variable assignments: name = value;
	// We look for assignments that aren't inside modules or functions.
	// To keep it simple but effective, we'll split by lines and look for start-of-line assignments.
	const lines = searchContent.split('\n');
	
	for (const line of lines) {
		// Ignore comments and empty lines
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

		// Regex for: name = value; // optional comment
		// Supports numbers (including decimals), booleans (true/false), and basic strings
		const match = /^\s*([a-zA-Z_]\w*)\s*=\s*([^;]+);/.exec(line);
		if (match) {
			const name  = match[1];
			const rawVal = match[2].trim();
			
			const parsed = parseValue(rawVal);
			if (parsed !== undefined) {
				params[name] = parsed;
			}
		}

		// Optimization: if we're not in a tagged block, stop at the first module/function/block
		if (!taggedMatch && /^\s*(module|function|if|for|include|use|\{|\[)/.test(line)) {
			break; 
		}
	}

	return params;
}

/**
 * Injects parameters back into the script.
 * It ensures the // PARAMETERS_START/END block exists at the top.
 */
export function injectOpenScadParameters(script: string, parameters: OpenScadParameters): string {
	const bindingLines = Object.entries(parameters)
		.map(([k, v]) => `${k} = ${formatValue(v)};`)
		.sort()
		.join('\n');
	
	const newBlock = `${START_TAG}\n${bindingLines}\n${END_TAG}`;
	
	const taggedRE = new RegExp(`${escapeRE(START_TAG)}[\\s\\S]*?${escapeRE(END_TAG)}`);
	
	if (taggedRE.test(script)) {
		return script.replace(taggedRE, newBlock);
	}

	// If no block exists, prepend it to the top of the file
	// But first, try to remove the raw variable assignments we might have found 
	// to avoid double-definition warnings if the script had them naked at the top.
	let cleanedScript = script;
	Object.keys(parameters).forEach(key => {
		const lineRE = new RegExp(`^\\s*${escapeRE(key)}\\s*=\\s*[^;]+;\\s*(\\/\\/.*)?$`, 'm');
		cleanedScript = cleanedScript.replace(lineRE, '');
	});

	return `${newBlock}\n\n${cleanedScript.trim()}`;
}

function parseValue(raw: string): unknown {
	const v = raw.trim();
	
	// Boolean
	if (v === 'true')  return true;
	if (v === 'false') return false;
	
	// Number (int or float)
	if (/^-?\d+(\.\d+)?$/.test(v)) return parseFloat(v);
	
	// String (wrapped in quotes)
	const strMatch = /^"([\s\S]*)"$/.exec(v);
	if (strMatch) return strMatch[1];

	// Array (simple [1, 2, 3])
	if (v.startsWith('[') && v.endsWith(']')) {
		try {
			// This is a bit risky but for simple arrays it works
			// We replace OpenSCAD style true/false with JS style
			const jsStyle = v.replace(/true/g, 'true').replace(/false/g, 'false');
			return JSON.parse(jsStyle);
		} catch {
			return undefined;
		}
	}

	return undefined;
}

function formatValue(v: unknown): string {
	if (typeof v === 'number') return v.toString();
	if (typeof v === 'boolean') return v ? 'true' : 'false';
	if (Array.isArray(v)) return `[${v.map(formatValue).join(', ')}]`;
	if (typeof v === 'string') return `"${v}"`;
	return JSON.stringify(v);
}

function escapeRE(s: string) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findNearestParameter(
    clickPoint: [number, number, number], 
    annotations: Record<string, AnnotationEntry>,
    geometryCenter: [number, number, number],
    geometryScale: number,
    threshold: number = 5.0
): string | null {
    const clickVec = new Vector3(...clickPoint);
    let nearestKey: string | null = null;
    let minDistance = Infinity;

    // Helper to transform raw OpenSCAD coords into our R3F World Space
    const transformPt = (pt: [number, number, number]) => {
        return new Vector3(
            (pt[0] - geometryCenter[0]) * geometryScale,
            (pt[1] - geometryCenter[1]) * geometryScale,
            (pt[2] - geometryCenter[2]) * geometryScale
        );
    };

    for (const [key, annotation] of Object.entries(annotations)) {
        let distance = Infinity;
        const type = annotation.type || (annotation.p1 && annotation.p2 ? 'height' : (annotation.center ? 'diameter' : 'height'));

        if ((type === 'diameter' || type === 'chamfer') && annotation.center && annotation.axis) {
            const centerVec = transformPt(annotation.center);
            const axisVec = new Vector3(...annotation.axis).normalize();
            
            // 1. Find shortest distance from click to the infinite central AXIS of the cylinder
            const pointToCenter = new Vector3().subVectors(clickVec, centerVec);
            const projectionLength = pointToCenter.dot(axisVec);
            const closestPointOnAxis = new Vector3().copy(centerVec).addScaledVector(axisVec, projectionLength);
            
            const distToAxis = clickVec.distanceTo(closestPointOnAxis);
            
            // 2. Subtract radius to get distance to the surface wall
            const rawRadius = annotation.radius || (annotation.value ? annotation.value / 2 : 10.0);
            const scaledRadius = rawRadius * geometryScale;
            
            distance = Math.abs(distToAxis - scaledRadius);
            
        } else if (type === 'height' && annotation.p1 && annotation.p2) {
            const p1Vec = transformPt(annotation.p1);
            const p2Vec = transformPt(annotation.p2);
            
            // Height features are defined by distance between two planes.
            // Users will click the top or bottom flat faces to edit height.
            const axisDir = new Vector3().subVectors(p2Vec, p1Vec).normalize();
            
            // Calculate point-to-plane distance for both the top and bottom faces
            const plane1Dist = Math.abs(new Vector3().subVectors(clickVec, p1Vec).dot(axisDir));
            const plane2Dist = Math.abs(new Vector3().subVectors(clickVec, p2Vec).dot(axisDir));
            
            // The distance is whichever plane they clicked closest to
            distance = Math.min(plane1Dist, plane2Dist);
        }

        if (distance < minDistance && distance <= threshold) {
            minDistance = distance;
            nearestKey = key;
        }
    }

    return nearestKey;
}
