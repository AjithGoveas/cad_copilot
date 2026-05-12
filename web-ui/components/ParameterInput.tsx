'use client';

type Props = {
	label:     string;
	value:     unknown;
	isFocused?: boolean;
	onChange:  (v: unknown) => void;
};

export function ParameterInput({ label, value, isFocused, onChange }: Props) {
	const focusRing = isFocused
		? 'border-amber-500/60 bg-amber-500/5 shadow-[0_0_12px_rgba(245,158,11,0.1)]'
		: 'border-white/5 bg-zinc-900/40';

	const inputCls = `w-full rounded-lg border ${focusRing} px-3 py-2 font-mono text-[12px] text-zinc-100 placeholder:text-zinc-700 focus:outline-none focus:border-amber-500/50 transition-all`;

	const displayLabel = label.replace(/_/g, ' ');

	return (
		<div className="space-y-2">
			<label className={`block font-mono text-[9px] font-semibold uppercase tracking-[0.2em] ${isFocused ? 'text-amber-400' : 'text-zinc-600'}`}>
				{displayLabel}
			</label>

			{typeof value === 'number' && (
				<div className="space-y-2">
					<div className="flex items-center gap-2">
						<input
							type="number"
							value={Number.isFinite(value) ? value : 0}
							onChange={(e) => onChange(Number(e.target.value))}
							className={`${inputCls} flex-1`}
						/>
						<span className="font-mono text-[9px] font-bold uppercase text-zinc-700">MM</span>
					</div>
					<input
						type="range"
						min={0}
						max={Math.max(100, (value as number) * 2)}
						step={0.1}
						value={Number.isFinite(value) ? value : 0}
						onChange={(e) => onChange(Number(e.target.value))}
						className="h-1 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-amber-500"
					/>
				</div>
			)}

			{typeof value === 'boolean' && (
				<label className="flex cursor-pointer items-center gap-3">
					<div className="relative flex size-5 items-center justify-center">
						<input
							type="checkbox"
							checked={value}
							onChange={(e) => onChange(e.target.checked)}
							className="peer size-full cursor-pointer appearance-none rounded border border-zinc-700 bg-zinc-900 transition checked:bg-amber-500 checked:border-amber-400"
						/>
						<span className="pointer-events-none absolute text-[10px] font-black text-black opacity-0 scale-0 peer-checked:opacity-100 peer-checked:scale-100 transition-all">✓</span>
					</div>
					<span className="font-mono text-[11px] text-zinc-400">Enabled</span>
				</label>
			)}

			{typeof value === 'string' && (
				<input
					type="text"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					className={inputCls}
				/>
			)}

			{typeof value !== 'number' && typeof value !== 'boolean' && typeof value !== 'string' && (
				<textarea
					value={JSON.stringify(value, null, 2)}
					rows={3}
					onChange={(e) => {
						try { onChange(JSON.parse(e.target.value)); } catch { /* partial edit */ }
					}}
					className={`${inputCls} resize-none`}
				/>
			)}
		</div>
	);
}
