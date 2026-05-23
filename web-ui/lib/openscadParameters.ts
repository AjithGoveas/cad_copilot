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
		}
		return merged;
	} catch (e) {
		console.error("Failed to infer annotations:", e);
		return explicitAnnotations;
	}
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

	function rotateVector(v: [number, number, number], r: [number, number, number]): [number, number, number] {
		const rx = (r[0] * Math.PI) / 180;
		const ry = (r[1] * Math.PI) / 180;
		const rz = (r[2] * Math.PI) / 180;

		let x = v[0], y = v[1], z = v[2];
		if (rx !== 0) {
			const cos = Math.cos(rx), sin = Math.sin(rx);
			const yNew = y * cos - z * sin;
			const zNew = y * sin + z * cos;
			y = yNew; z = zNew;
		}
		if (ry !== 0) {
			const cos = Math.cos(ry), sin = Math.sin(ry);
			const xNew = x * cos + z * sin;
			const zNew = -x * sin + z * cos;
			x = xNew; z = zNew;
		}
		if (rz !== 0) {
			const cos = Math.cos(rz), sin = Math.sin(rz);
			const xNew = x * cos - y * sin;
			const yNew = x * sin + y * cos;
			x = xNew; y = yNew;
		}
		return [x, y, z];
	}

	const moduleRegex = /module\s+(\w+)\s*\([^)]*\)\s*\{([\s\S]*?)\}/g;
	let match;

	while ((match = moduleRegex.exec(script)) !== null) {
		const moduleBody = match[2];

		let tx = 0, ty = 0, tz = 0;
		const translateRegex = /translate\(\s*\[\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^\]]+)\s*\]\s*\)/g;
		let tMatch;
		while ((tMatch = translateRegex.exec(moduleBody)) !== null) {
			tx += evaluateExpression(tMatch[1]);
			ty += evaluateExpression(tMatch[2]);
			tz += evaluateExpression(tMatch[3]);
		}

		let rx = 0, ry = 0, rz = 0;
		const rotateRegex = /rotate\(\s*\[\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^\]]+)\s*\]\s*\)/g;
		let rMatch;
		while ((rMatch = rotateRegex.exec(moduleBody)) !== null) {
			rx += evaluateExpression(rMatch[1]);
			ry += evaluateExpression(rMatch[2]);
			rz += evaluateExpression(rMatch[3]);
		}

		const cylinderRegex = /cylinder\s*\(\s*([^)]+)\s*\)/g;
		let cylMatch;
		while ((cylMatch = cylinderRegex.exec(moduleBody)) !== null) {
			const cylParams = cylMatch[1];
			
			const dMatch = /\bd\s*=\s*([a-zA-Z_]\w*)/.exec(cylParams);
			const rMatch = /\br\s*=\s*([a-zA-Z_]\w*)/.exec(cylParams);
			const hMatch = /\bh\s*=\s*([a-zA-Z_]\w*(?:\s*[-+]\s*[a-zA-Z0-9_]+)*)/.exec(cylParams);
			const centerMatch = /\bcenter\s*=\s*(true|false)/.exec(cylParams);
			const isCentered = centerMatch ? centerMatch[1] === 'true' : false;

			let hVal = 0;
			if (hMatch) {
				hVal = evaluateExpression(hMatch[1]);
			}

			const baseAxis: [number, number, number] = [0, 0, 1];
			const worldAxis = rotateVector(baseAxis, [rx, ry, rz]);

			if (dMatch || rMatch) {
				const paramName = dMatch ? dMatch[1] : rMatch![1];
				if (params[paramName] !== undefined) {
					const localCenter: [number, number, number] = isCentered ? [0, 0, 0] : [0, 0, hVal / 2];
					const rotatedCenter = rotateVector(localCenter, [rx, ry, rz]);
					const worldCenter: [number, number, number] = [
						tx + rotatedCenter[0],
						ty + rotatedCenter[1],
						tz + rotatedCenter[2],
					];

					annotations[paramName] = {
						type: 'diameter',
						center: worldCenter,
						axis: worldAxis,
						value: dMatch ? params[paramName] : (params[paramName] as number) * 2,
					};
				}
			}

			if (hMatch) {
				for (const paramName of Object.keys(params)) {
					const re = new RegExp(`\\b${paramName}\\b`);
					if (re.test(hMatch[1])) {
						const localP1: [number, number, number] = isCentered ? [0, 0, -hVal / 2] : [0, 0, 0];
						const localP2: [number, number, number] = isCentered ? [0, 0, hVal / 2] : [0, 0, hVal];

						const rotP1 = rotateVector(localP1, [rx, ry, rz]);
						const rotP2 = rotateVector(localP2, [rx, ry, rz]);

						annotations[paramName] = {
							type: 'height',
							p1: [tx + rotP1[0], ty + rotP1[1], tz + rotP1[2]],
							p2: [tx + rotP2[0], ty + rotP2[1], tz + rotP2[2]],
							value: params[paramName] as number,
						};
						break;
					}
				}
			}
		}

		const cubeRegex = /cube\s*\(\s*\[\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^\]]+)\s*\]\s*(?:,\s*center\s*=\s*(true|false))?\s*\)/g;
		let cubeMatch;
		while ((cubeMatch = cubeRegex.exec(moduleBody)) !== null) {
			const xExpr = cubeMatch[1];
			const yExpr = cubeMatch[2];
			const zExpr = cubeMatch[3];
			const isCentered = cubeMatch[4] === 'true';

			const xVal = evaluateExpression(xExpr);
			const yVal = evaluateExpression(yExpr);
			const zVal = evaluateExpression(zExpr);

			const expressions = [xExpr, yExpr, zExpr];
			const values = [xVal, yVal, zVal];

			for (let i = 0; i < 3; i++) {
				for (const paramName of Object.keys(params)) {
					const re = new RegExp(`\\b${paramName}\\b`);
					if (re.test(expressions[i])) {
						const lengthVal = values[i];
						
						let localP1: [number, number, number] = [0, 0, 0];
						let localP2: [number, number, number] = [0, 0, 0];

						if (isCentered) {
							localP1[i] = -lengthVal / 2;
							localP2[i] = lengthVal / 2;
						} else {
							localP1[i] = 0;
							localP2[i] = lengthVal;
						}

						const rotP1 = rotateVector(localP1, [rx, ry, rz]);
						const rotP2 = rotateVector(localP2, [rx, ry, rz]);

						annotations[paramName] = {
							type: 'height',
							p1: [tx + rotP1[0], ty + rotP1[1], tz + rotP1[2]],
							p2: [tx + rotP2[0], ty + rotP2[1], tz + rotP2[2]],
							value: params[paramName] as number,
						};
						break;
					}
				}
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

