export type OpenScadParameters = Record<string, unknown>;

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

