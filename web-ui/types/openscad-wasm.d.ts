declare module 'openscad-wasm' {
	export type OpenScadInstance = {
		renderToStl: (code: string) => Promise<string>;
	};

	export type InitOptions = {
		noInitialRun?: boolean;
		print?: (text: string) => void;
		printErr?: (text: string) => void;
		locateFile?: (path: string, prefix?: string) => string;
	};

	export function createOpenSCAD(options?: InitOptions): Promise<OpenScadInstance>;
}
