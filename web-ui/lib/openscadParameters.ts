export type OpenScadParameters = Record<string, unknown>;

const PARAM_JSON_RE = /\/\*\s*PARAMETERS_JSON\s*([\s\S]*?)\*\//;
const START_TAG = '// PARAMETERS_START';
const END_TAG = '// PARAMETERS_END';

export function extractOpenScadParameters(script: string): OpenScadParameters {
	const match = PARAM_JSON_RE.exec(script);
	if (!match) return {};
	try {
		const parsed = JSON.parse(match[1].trim());
		return (parsed && typeof parsed === 'object') ? parsed : {};
	} catch {
		return {};
	}
}

export function injectOpenScadParameters(script: string, parameters: OpenScadParameters): string {
	const jsonBlock = `/* PARAMETERS_JSON\n${JSON.stringify(parameters, null, 2)}\n*/`;
	const bindingLines = Object.entries(parameters)
		.map(([k, v]) => `${k} = ${formatValue(v)};`)
		.join('\n');
	const bindingBlock = `${START_TAG}\n${bindingLines}\n${END_TAG}`;

	let updated = script;
	
	// Update JSON Block
	if (PARAM_JSON_RE.test(updated)) {
		updated = updated.replace(PARAM_JSON_RE, jsonBlock);
	} else {
		updated = `${jsonBlock}\n\n${updated}`;
	}

	// Update Binding Block
	const bindingRE = new RegExp(`${escapeRE(START_TAG)}[\\s\\S]*?${escapeRE(END_TAG)}`);
	if (bindingRE.test(updated)) {
		updated = updated.replace(bindingRE, bindingBlock);
	} else {
		updated = updated.replace(PARAM_JSON_RE, (m) => `${m}\n\n${bindingBlock}`);
	}

	return updated;
}

function formatValue(v: unknown): string {
	if (typeof v === 'number') return v.toString();
	if (typeof v === 'boolean') return v ? 'true' : 'false';
	if (Array.isArray(v)) return `[${v.map(formatValue).join(', ')}]`;
	return JSON.stringify(v);
}

function escapeRE(s: string) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
